// The daily research brief (schedule in server.ts, after the morning's quotes and nominations): first the
// rule check of the open judgments, then a candidate card for each instrument worth a look today (at most 8
// model calls), then everything in one brief per Beijing date, written once. A candidate opens a judgment;
// a lead is only listed. When the model cannot be asked, the brief still carries the checks, the events and
// the market, and says why it has no cards.
import { beijingDate } from "@aihot/contracts/time";
import { sql } from "@aihot/backend/db";
import { modelRoute } from "@aihot/backend/editorial/models";
import { promptText, promptVersion } from "@aihot/backend/editorial/prompts";
import { chatJson } from "@aihot/backend/providers/llm";
import { completeReceipt, failureKind } from "@aihot/backend/providers/receipts";
import { BRIEF_NOTE, OPEN_STATUSES, type Brief, type BriefEntry, type InstrumentView } from "../contract.ts";
import { CardSchema, acceptCard, cardInput, recentReports } from "./cards.ts";
import { listEvents } from "./events.ts";
import { listInstruments } from "./read.ts";
import { checkTheses, listTheses, openThesis } from "./theses.ts";

const MAX_CARDS = 8;

/** Who gets a card today: on the list or nominated, flagged, or with an official event within a week. */
export function pickInstruments(views: InstrumentView[], openOn: Set<string>, today: string): InstrumentView[] {
  const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const score = (v: InstrumentView) =>
    (v.watch?.state === "watching" ? 4 : v.watch?.state === "nominated" ? 2 : 0) + v.flags.length
    + (v.upcoming.some((e) => e.confirmation === "official" && e.startsOn !== null && e.startsOn <= week) ? 2 : 0);
  return views
    .filter((v) => v.role === "candidate" && v.entityId && v.watch?.state !== "dropped" && !openOn.has(v.id) && score(v) > 0)
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
    .slice(0, MAX_CARDS);
}

export async function existingBrief(day: string): Promise<Brief | null> {
  const [row] = await sql<{ content: Brief }[]>`SELECT content FROM research_briefs WHERE day = ${day}::date`;
  return row?.content ?? null;
}

export async function latestBrief(): Promise<Brief | null> {
  const [row] = await sql<{ content: Brief }[]>`SELECT content FROM research_briefs ORDER BY day DESC LIMIT 1`;
  return row?.content ?? null;
}

export async function composeBrief(now = new Date()): Promise<{ day: string; written: boolean; candidates: number; leads: number; problems: string[] }> {
  const day = beijingDate(now);
  const done = await existingBrief(day);
  if (done) return { day, written: false, candidates: done.candidates.length, leads: done.leads.length, problems: done.problems };

  const updates = await checkTheses(now);
  const [list, events, open] = await Promise.all([listInstruments(now), listEvents({ now, days: 21 }), listTheses({ open: true })]);
  const problems: string[] = [];
  const candidates: BriefEntry[] = [], leads: BriefEntry[] = [];
  const receipts: number[] = [];
  const picked = pickInstruments(list.instruments, new Set(open.map((t) => t.instrument)), day);
  if (picked.length) {
    const { model, fallbackModel } = await modelRoute("researchCard");
    const system = promptText("research-card", { today: day });
    const version = promptVersion("research-card");
    for (const v of picked) {
      const given = cardInput(v, await recentReports(v.entityId!, now), v.upcoming, now);
      try {
        const res = await chatJson({ model, fallbackModel, purpose: "research_card", subject: `${day}:${v.id}`, promptVersion: version, system, user: JSON.stringify(given.input), schema: CardSchema, temperature: 0.2, maxTokens: 2500 });
        receipts.push(res.receiptId);
        const { card, dropped } = acceptCard(res.data, given, v.quote?.price ?? null);
        if (dropped.length) problems.push(`${v.name}：去掉了 ${dropped.length} 处没有依据或越界的内容`);
        await sql.begin(async (tx) => {
          if (card?.level === "candidate") {
            const thesisId = await openThesis(tx, { instrument: v.id, origin: "brief", card, reason: `${day} 研究简报候选`, author: "model", price: v.quote?.price ?? null, priceAt: v.quote ? new Date(v.quote.at) : null, receiptId: res.receiptId, now });
            candidates.push({ instrument: v, card, thesisId });
          } else if (card) leads.push({ instrument: v, card, thesisId: null });
          await completeReceipt(tx, res.receiptId);
        });
      } catch (error) {
        const kind = failureKind(error);
        const message = error instanceof Error ? error.message : String(error);
        if (kind === "other") throw error;
        problems.push(`${v.name}：${kind === "off" ? "模型调用已关闭" : kind === "unusable" ? "模型的回答不合格式" : message}`.slice(0, 200));
        if (kind !== "unusable" && kind !== "refused") break;
      }
    }
  }
  const opened = new Set(candidates.map((c) => c.thesisId));
  const brief: Brief = {
    day, generatedAt: now.toISOString(), note: BRIEF_NOTE, candidates, leads, updates,
    open: (await listTheses({ open: true })).filter((t) => !opened.has(t.id) && OPEN_STATUSES.includes(t.status))
      .map((t) => ({ thesisId: t.id, instrument: t.instrument, instrumentName: t.instrumentName, status: t.status, until: t.until })),
    events,
    watchlist: list.instruments.filter((v) => v.watch?.state === "watching"),
    context: list.instruments.filter((v) => v.role === "context"),
    problems,
  };
  await sql`INSERT INTO research_briefs (day, generated_at, content, receipt_ids) VALUES (${day}::date, ${now}, ${sql.json(brief as never)}, ${receipts}) ON CONFLICT (day) DO NOTHING`;
  return { day, written: true, candidates: candidates.length, leads: leads.length, problems };
}
