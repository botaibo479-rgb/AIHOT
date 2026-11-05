// The research module's backend (docs/research-plan.md, steps 2 and 3): quotes of the instruments in
// instruments.json, the watchlist nominated by how much they are reported, the event calendar, and the ways
// to read them.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { defineServerModule } from "@aihot/backend/modules";
import type { Finding } from "@aihot/backend/notify/feishu";
import { authorized, unauthorized } from "@aihot/api/routes/ingest";
import type { InstrumentView, WatchState } from "./contract.ts";
import { CATALOG } from "./backend/catalog.ts";
import { collectDaily, collectSnapshots, pruneSnapshots } from "./backend/collect.ts";
import { OwnerEvent, addOwnerEvent, listEvents, scanReports, withdrawEvent } from "./backend/events.ts";
import { detailAnswer, eventsAnswer, listAnswer } from "./backend/markdown.ts";
import { instrumentDetail, listInstruments } from "./backend/read.ts";
import { WatchError, decide, nominate } from "./backend/watch.ts";

const collecting = () => process.env.COLLECT_ENABLED === "true";
const CACHE = "public, max-age=30";

const Decision = z.strictObject({ state: z.enum(["watching", "dropped"]), reason: z.string().trim().max(200).optional() });

function http(app: FastifyInstance) {
  app.get("/api/research/instruments", async (_req, reply) => reply.header("Cache-Control", CACHE).send(await listInstruments()));
  app.get<{ Params: { id: string } }>("/api/research/instruments/:id", async (req, reply) => {
    const detail = await instrumentDetail(req.params.id);
    if (!detail) return reply.code(404).header("Cache-Control", CACHE).send({ error: "not_found" });
    return reply.header("Cache-Control", CACHE).send(detail);
  });
  // The owner's decision, with the ingest token (the site's one write credential for scripts and Agents).
  app.post<{ Params: { id: string } }>("/api/research/watch/:id", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!authorized(req)) return unauthorized(reply);
    const body = Decision.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: "state must be watching or dropped; reason at most 200 characters" });
    try {
      await decide(req.params.id, body.data.state as WatchState, body.data.reason || null);
    } catch (error) {
      if (error instanceof WatchError) return reply.code(error.status).send({ ok: false, error: error.message });
      throw error;
    }
    return { ok: true };
  });

  app.get<{ Querystring: { days?: string; instrument?: string } }>("/api/research/events", async (req, reply) => {
    const days = req.query.days === undefined ? 21 : Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) return reply.code(400).send({ error: "days is 1 to 90" });
    const instrument = req.query.instrument ? CATALOG.instruments.find((i) => i.id === req.query.instrument!.toLowerCase()) : null;
    if (req.query.instrument && !instrument?.entityId) return reply.code(404).send({ error: "not_found" });
    return reply.header("Cache-Control", CACHE).send(await listEvents({ days, entity: instrument?.entityId ?? null }));
  });
  // The owner's own events, and taking a wrong one off the calendar (kept, with why).
  app.post("/api/research/events", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!authorized(req)) return unauthorized(reply);
    const body = OwnerEvent.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    try {
      return { ok: true, id: await addOwnerEvent(body.data) };
    } catch (error) {
      if (error instanceof RangeError) return reply.code(400).send({ ok: false, error: error.message });
      throw error;
    }
  });
  app.post<{ Params: { id: string } }>("/api/research/events/:id/withdraw", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!authorized(req)) return unauthorized(reply);
    const body = z.strictObject({ reason: z.string().trim().min(1).max(200) }).safeParse(req.body ?? {});
    const id = Number(req.params.id);
    if (!body.success || !Number.isSafeInteger(id)) return reply.code(400).send({ ok: false, error: "a reason (at most 200 characters) is required" });
    if (!(await withdrawEvent(id, body.data.reason))) return reply.code(404).send({ ok: false, error: "no such event on the calendar" });
    return { ok: true };
  });
}

const EVENTS_INPUT = z.strictObject({
  days: z.number().int().min(1).max(90).default(21).describe("How many days ahead, 1 to 90. Defaults to 21."),
  instrument: z.string().trim().min(1).max(40).optional().describe("Optional instrument id such as btc or dgs10, to keep its events only."),
});

const INSTRUMENT_INPUT = z.strictObject({
  symbol: z.string().trim().min(1).max(40).optional().describe("Optional instrument id, symbol or name, such as btc, IBIT or dgs10. Omit for the whole watchlist with the market background."),
});

/** Stale quotes while collection runs: crypto snapshots over an hour old, daily values over 5 days old. */
async function staleQuotes(now: number): Promise<Finding[]> {
  if (!collecting()) return [];
  const list = await listInstruments(new Date(now));
  const stale = (pick: (v: InstrumentView) => boolean) => list.instruments.filter((v) => v.quote?.stale && pick(v)).map((v) => v.id);
  const crypto = stale((v) => !v.quote!.daily);
  const daily = stale((v) => v.quote!.daily);
  const findings: Finding[] = [];
  if (crypto.length) findings.push({ key: "research:stale-crypto", level: "today", title: "加密行情超过 1 小时没有更新", impact: `观察清单和标的页显示的是旧价格：${crypto.join("、")}`, action: "看 worker 日志里 research.snapshots 的失败原因，确认服务器能连上交易所接口" });
  if (daily.length) findings.push({ key: "research:stale-daily", level: "later", title: "日线行情超过 5 天没有更新", impact: daily.join("、"), action: "看 research.daily 的运行结果：可能是密钥失效或额度用完" });
  return findings;
}

export default defineServerModule({
  name: "research",
  http,
  schedules: [
    { name: "research.snapshots", cron: "*/15 * * * *", run: () => collectSnapshots(), when: collecting },
    // After the UTC day closes (08:00 Beijing) and after the US session's values are out.
    { name: "research.daily", cron: "12 8 * * *", run: () => collectDaily(), missed: "once", when: collecting },
    { name: "research.nominate", cron: "25 8 * * *", run: () => nominate(), missed: "once" },
    // The calendar file, then the recent reports' future events (model calls; MODEL_CALLS_ENABLED applies).
    { name: "research.events", cron: "7,37 * * * *", run: () => scanReports() },
  ],
  models: {
    catalyst: { label: "研究：从报道里抽未来事件（事件日历）", env: "CATALYST_MODEL", purposes: ["research_catalyst"] },
  },
  agent: {
    abilities: [{
      path: "/instruments",
      title: "观察清单与行情",
      ask: "观察清单上有哪些标的，某个标的现在的价格、资金费率、未平仓量和筛选标记",
      answer: async () => listAnswer(await listInstruments()),
      etagPrefix: "research-instruments",
      cacheControl: "public, max-age=60",
      mcp: {
        tool: "get_instrument",
        use: "for the watchlist, quotes, perpetual-contract numbers and screening flags of tracked instruments",
        description: "Get the watchlist with the latest quotes, or one instrument's quote, 7-day move, funding rate, open interest, coverage counts and screening flags. Flags are threshold screens, not trading signals.",
        input: INSTRUMENT_INPUT,
        run: async (args) => {
          const symbol = typeof args.symbol === "string" ? args.symbol : null;
          if (!symbol) {
            const list = await listInstruments();
            return { text: listAnswer(list), structured: { schemaVersion: 1, ...list } };
          }
          const detail = await instrumentDetail(symbol);
          if (!detail) {
            const ids = CATALOG.instruments.map((i) => i.id).join(", ");
            return { text: `没有叫「${symbol}」的标的。可以查的：${ids}。`, structured: { schemaVersion: 1, instrument: null, known: CATALOG.instruments.map((i) => i.id) } };
          }
          return { text: detailAnswer(detail), structured: { schemaVersion: 1, instrument: detail } };
        },
      },
    }, {
      path: "/events",
      title: "事件日历",
      ask: "未来几天到几周有哪些事件（议息、数据发布、解锁、升级、审批），哪些是正式日程、哪些是暂定或推测",
      answer: async () => eventsAnswer(await listEvents()),
      etagPrefix: "research-events",
      cacheControl: "public, max-age=60",
      mcp: {
        tool: "list_events",
        use: "for upcoming scheduled, tentative and speculative events, each with its date, instruments and source",
        description: "List upcoming events in three groups: official schedules, tentative plans and speculation (never a schedule). Each has its date and precision, the instruments it concerns and its source quote. No probabilities or consensus are given.",
        input: EVENTS_INPUT,
        run: async (args) => {
          const { days, instrument } = EVENTS_INPUT.parse(args);
          const found = instrument ? CATALOG.instruments.find((i) => i.id === instrument.toLowerCase()) : null;
          if (instrument && !found?.entityId) return { text: `没有叫「${instrument}」、能查事件的标的。`, structured: { schemaVersion: 1, events: null } };
          const list = await listEvents({ days, entity: found?.entityId ?? null });
          return { text: eventsAnswer(list), structured: { schemaVersion: 1, ...list } };
        },
      },
    }],
  },
  topics: {
    page: {
      index: async (_members, now) => {
        const byEntity: Record<string, InstrumentView[]> = {};
        for (const v of (await listInstruments(now)).instruments) if (v.entityId) (byEntity[v.entityId] ??= []).push(v);
        return byEntity;
      },
      read: (ask) => {
        const views = ask.topic.entityId ? (ask.index as Record<string, InstrumentView[]> | undefined)?.[ask.topic.entityId] : undefined;
        return views?.length ? { recheck: [], part: () => views } : null;
      },
    },
  },
  alerts: staleQuotes,
  retention: (now) => pruneSnapshots(now),
});

