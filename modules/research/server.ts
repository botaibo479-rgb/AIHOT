// The research module's backend (docs/research-plan.md, steps 2 to 4): quotes of the instruments in
// instruments.json, the watchlist nominated by how much they are reported, the event calendar, the daily
// brief with its candidate cards, the judgment archive, and the ways to read them.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { defineServerModule } from "@aihot/backend/modules";
import type { Finding } from "@aihot/backend/notify/feishu";
import { authorized, unauthorized } from "@aihot/api/routes/ingest";
import type { Card, InstrumentView, WatchState } from "./contract.ts";
import { composeBrief, existingBrief, latestBrief } from "./backend/brief.ts";
import { ThesisError, getThesis, latestPrice, listTheses, openThesis, ownerRevision } from "./backend/theses.ts";
import { sql } from "@aihot/backend/db";
import { CATALOG } from "./backend/catalog.ts";
import { collectDaily, collectSnapshots, pruneSnapshots } from "./backend/collect.ts";
import { OwnerEvent, addOwnerEvent, listEvents, scanReports, withdrawEvent } from "./backend/events.ts";
import { briefAnswer, detailAnswer, eventsAnswer, listAnswer, thesesAnswer, thesisAnswer } from "./backend/markdown.ts";
import { instrumentDetail, listInstruments } from "./backend/read.ts";
import { WatchError, decide, nominate } from "./backend/watch.ts";

const collecting = () => process.env.COLLECT_ENABLED === "true";
const CACHE = "public, max-age=30";

const Decision = z.strictObject({ state: z.enum(["watching", "dropped"]), reason: z.string().trim().max(200).optional() });

function http(app: FastifyInstance) {
  briefRoutes(app);
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

const Condition = z.strictObject({
  text: z.string().trim().min(1).max(200),
  price: z.number().positive().optional(),
  op: z.enum([">=", "<="]).optional(),
});
const OwnerThesis = z.strictObject({
  instrument: z.string().trim().min(1).max(40),
  whyNow: z.string().trim().min(1).max(300),
  triggers: z.array(Condition).min(1).max(4),
  invalidations: z.array(Condition).min(1).max(4),
  horizonDays: z.number().int().min(3).max(90).default(14),
  risks: z.array(z.string().trim().min(1).max(200)).max(4).default([]),
});
const OwnerRevision = z.strictObject({
  kind: z.enum(["note", "status"]),
  status: z.enum(["watching", "triggered", "invalidated", "withdrawn"]).optional(),
  reason: z.string().trim().min(1).max(500),
});
const toCondition = (c: z.infer<typeof Condition>) => ({ text: c.text, ...(c.price ? { check: { metric: "price" as const, op: c.op ?? ">=", value: c.price } } : {}) });

function briefRoutes(app: FastifyInstance) {
  // { brief: null } before the first one, so a page can say so.
  app.get("/api/research/briefs/latest", async (_req, reply) => reply.header("Cache-Control", CACHE).send({ brief: await latestBrief() }));
  app.get<{ Params: { day: string } }>("/api/research/briefs/:day", async (req, reply) => {
    const brief = /^\d{4}-\d{2}-\d{2}$/.test(req.params.day) ? await existingBrief(req.params.day) : null;
    return brief ? reply.header("Cache-Control", CACHE).send(brief) : reply.code(404).header("Cache-Control", CACHE).send({ error: "not_found" });
  });
  app.get<{ Querystring: { status?: string } }>("/api/research/theses", async (req, reply) => {
    const status = req.query.status ?? "all";
    if (!["open", "ended", "all"].includes(status)) return reply.code(400).send({ error: "status is open, ended or all" });
    const theses = await listTheses(status === "all" ? {} : { open: status === "open" });
    return reply.header("Cache-Control", CACHE).send({ theses });
  });
  app.get<{ Params: { id: string } }>("/api/research/theses/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const thesis = Number.isSafeInteger(id) ? await getThesis(id) : null;
    return thesis ? reply.header("Cache-Control", CACHE).send(thesis) : reply.code(404).header("Cache-Control", CACHE).send({ error: "not_found" });
  });
  // The owner's own judgment, and the owner's notes and decisions on any judgment (appended, never edited).
  app.post("/api/research/theses", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!authorized(req)) return unauthorized(reply);
    const body = OwnerThesis.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const instrument = CATALOG.instruments.find((i) => i.id === body.data.instrument.toLowerCase());
    if (!instrument) return reply.code(404).send({ ok: false, error: "unknown instrument" });
    const card: Card = {
      level: "candidate", whyNow: body.data.whyNow, catalysts: [], evidence: { capital: [], narrative: [], rules: [] }, gaps: ["站长开立：证据见理由与笔记"],
      triggers: body.data.triggers.map(toCondition), invalidations: body.data.invalidations.map(toCondition), risks: body.data.risks, horizonDays: body.data.horizonDays,
    };
    const price = await latestPrice(instrument.id);
    const now = new Date();
    const id = await sql.begin((tx) => openThesis(tx, { instrument: instrument.id, origin: "owner", card, reason: "站长开立", author: "owner", price: price?.price ?? null, priceAt: price?.at ?? null, now }));
    return { ok: true, id };
  });
  app.post<{ Params: { id: string } }>("/api/research/theses/:id/revisions", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!authorized(req)) return unauthorized(reply);
    const body = OwnerRevision.safeParse(req.body ?? {});
    const id = Number(req.params.id);
    if (!body.success || !Number.isSafeInteger(id)) return reply.code(400).send({ ok: false, error: "kind is note or status (with status), and a reason is required" });
    try {
      await ownerRevision(id, body.data);
    } catch (error) {
      if (error instanceof ThesisError) return reply.code(error.status).send({ ok: false, error: error.message });
      throw error;
    }
    return { ok: true };
  });
}

const BRIEF_INPUT = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Optional Beijing date YYYY-MM-DD. Omit for the latest brief."),
});
const THESIS_INPUT = z.strictObject({
  id: z.number().int().positive().optional().describe("Optional judgment id. Omit for the open judgments."),
});

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
    // After the quotes (08:12), the nominations (08:25) and the morning's event reading.
    { name: "research.brief", cron: "45 8 * * *", run: () => composeBrief(), missed: "once" },
  ],
  models: {
    researchCard: { label: "研究：候选卡（研究简报）", env: "RESEARCH_MODEL", purposes: ["research_card"] },
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
    }, {
      path: "/brief",
      title: "研究简报",
      ask: "今天值得关注的标的、它们的三权证据与缺口、触发与失效条件，以及已有判断的变化",
      answer: async () => { const b = await latestBrief(); return b ? briefAnswer(b) : "# 研究简报\n\n还没有生成过研究简报（每天 08:45 北京时间生成）。"; },
      etagPrefix: "research-brief",
      cacheControl: "public, max-age=60",
      mcp: {
        tool: "get_brief",
        use: "for the daily research brief: candidate cards with evidence, gaps, triggers and invalidations, judgment updates and upcoming events",
        description: "Get the daily research brief (latest, or for a Beijing date): candidate instruments with capital, narrative and rule evidence each citing its source, gaps, trigger and invalidation conditions, leads, updates of earlier judgments, upcoming events and market background. Research preparation, not trading advice.",
        input: BRIEF_INPUT,
        run: async (args) => {
          const { date } = BRIEF_INPUT.parse(args);
          const brief = date ? await existingBrief(date) : await latestBrief();
          if (!brief) return { text: date ? `${date} 没有研究简报。` : "还没有生成过研究简报。", structured: { schemaVersion: 1, brief: null } };
          return { text: briefAnswer(brief), structured: { schemaVersion: 1, brief } };
        },
      },
    }, {
      path: "/theses",
      title: "判断档案",
      ask: "进行中的判断，以及某个判断从开立到结束的全部修订和复盘",
      answer: async () => thesesAnswer(await listTheses({ open: true })),
      etagPrefix: "research-theses",
      cacheControl: "public, max-age=60",
      mcp: {
        tool: "get_thesis",
        use: "for the judgment archive: open judgments, or one judgment with every revision and its review",
        description: "Without an id, list the open judgments. With an id, get one judgment: its current card and every revision as written (append-only), with status changes, notes and the review of how the price went against its benchmark.",
        input: THESIS_INPUT,
        run: async (args) => {
          const { id } = THESIS_INPUT.parse(args);
          if (id === undefined) {
            const open = await listTheses({ open: true });
            return { text: thesesAnswer(open), structured: { schemaVersion: 1, theses: open } };
          }
          const thesis = await getThesis(id);
          if (!thesis) return { text: `没有编号为 ${id} 的判断。`, structured: { schemaVersion: 1, thesis: null } };
          return { text: thesisAnswer(thesis), structured: { schemaVersion: 1, thesis } };
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

