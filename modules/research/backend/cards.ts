// A candidate card for one instrument: what the model is shown (every fact numbered, so each piece of
// evidence names where it comes from) and what of its answer is kept. A card is only what its inputs
// support: evidence citing nothing given is dropped, a sentence naming a name or a figure not in the inputs
// is dropped, and a card with neither money nor rules behind it is only a lead.
import { z } from "zod";
import { beijingDate } from "@aihot/contracts/time";
import { sql } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";
import { grounded } from "@aihot/backend/reports/compose";
import { formatMove, formatNumber, type Card, type Condition, type Evidence, type EventView, type InstrumentView } from "../contract.ts";

interface ReportRow { id: string; title: string; summary: string | null; tier: string; score: string | null; at: Date }

/** The instrument's public reports of the last 7 days, the best scored first (at most 8). */
export async function recentReports(entityId: string, now: Date): Promise<ReportRow[]> {
  return sql<ReportRow[]>`
    SELECT p.article_id AS id, p.title, p.summary, s.tier, p.score, p.timeline_at AS at
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${listedCondition(now)} AND p.tags @> ${[`entity:${entityId}`]}::text[] AND p.timeline_at >= ${new Date(now.getTime() - 7 * 86_400_000)}
    ORDER BY p.score DESC NULLS LAST, p.timeline_at DESC LIMIT 8`;
}

const pct = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? null : `${(v * 100).toFixed(digits)}%`);
const round = (v: number | null | undefined, digits = 4) => (v === null || v === undefined ? null : Number(v.toPrecision(8)).toFixed(digits).replace(/\.?0+$/, ""));

export interface CardInput {
  /** The JSON the model reads. */
  input: Record<string, unknown>;
  /** Every number it may cite: metric keys, a:<report id>, e:<event id>. */
  refs: Set<string>;
  /** All the words of the input, for grounding what it writes. */
  corpus: string;
}

/**
 * The background series that bear on an instrument: of its own entity (BTC's DVOL and CME positioning, oil's
 * inventories), or of its market with no entity (stablecoin supply for crypto, the indices for stocks).
 */
export function relatedOf(view: InstrumentView, all: InstrumentView[]): InstrumentView[] {
  return all.filter((r) => r.id !== view.id && r.role === "context" && r.quote && (r.entityId ? r.entityId === view.entityId : r.market === view.market));
}

export function cardInput(view: InstrumentView, reports: ReportRow[], events: EventView[], now: Date, related: InstrumentView[] = []): CardInput {
  const q = view.quote;
  const metrics: Record<string, string | number | null> = {};
  if (q) {
    Object.assign(metrics, {
      "quote.price": round(q.price), "quote.source": q.label, "quote.at": q.at.slice(0, 16), "quote.unit": q.unit,
      "quote.change1d": q.points ? round(q.changePoints1d, 2) : pct(q.change1d), "quote.change7d": q.points ? round(q.changePoints7d, 2) : pct(q.change7d),
      "quote.volatility30d": pct(q.volatility30d), "quote.volumeRatio": round(q.volumeRatio, 2), "quote.stale": q.stale ? "是" : "否",
    });
    if (q.perp) Object.assign(metrics, {
      "perp.contract": q.perp.label, "perp.fundingRate": pct(q.perp.fundingRate, 4), "perp.openInterest": round(q.perp.openInterest, 2),
      "perp.openInterestChange7d": pct(q.perp.openInterestChange7d, 1), "perp.basis": pct(q.perp.basis, 3),
    });
  }
  if (view.attention) Object.assign(metrics, {
    "attention.sources48h": view.attention.sources48h, "attention.sourcesPrev48h": view.attention.sourcesPrev48h, "attention.reports48h": view.attention.reports48h,
  });
  for (const r of related) {
    const rq = r.quote!;
    metrics[`rel.${r.id}`] = `${r.name}：${formatNumber(rq.price)}${rq.unit === "%" ? "%" : rq.unit ? ` ${rq.unit}` : ""}，${rq.daily ? "1 期" : "24 小时"} ${formatMove(rq, "1d")}，7 日 ${formatMove(rq, "7d")}（${rq.label}，${rq.at.slice(0, 10)}${rq.stale ? "，已过期" : ""}）`;
  }
  for (const k of Object.keys(metrics)) if (metrics[k] === null) delete metrics[k];
  const input = {
    instrument: { id: view.id, name: view.name, market: view.market, kind: view.kind, watch: view.watch?.state ?? null },
    today: beijingDate(now),
    metrics,
    flags: view.flags.map((f) => `${f.label}：${f.detail}`),
    reports: reports.map((r) => ({ ref: `a:${r.id}`, title: r.title, summary: r.summary, tier: r.tier, score: r.score === null ? null : Number(r.score), date: beijingDate(r.at) })),
    events: events.map((e) => ({ ref: `e:${e.id}`, title: e.title, date: e.startsOn, precision: e.precision, confirmation: e.confirmation, quote: e.quote })),
  };
  return { input, refs: new Set([...Object.keys(metrics), ...input.reports.map((r) => r.ref), ...input.events.map((e) => e.ref)]), corpus: JSON.stringify(input) };
}

const Ev = z.object({ claim: z.string(), ref: z.string() });
const Cond = z.object({ text: z.string(), check: z.object({ metric: z.literal("price"), op: z.enum([">=", "<="]), value: z.number().positive() }).nullish() });
export const CardSchema = z.object({
  level: z.enum(["candidate", "lead", "none"]),
  whyNow: z.string().catch(""),
  catalysts: z.array(z.string()).catch([]),
  evidence: z.object({ capital: z.array(Ev).catch([]), narrative: z.array(Ev).catch([]), rules: z.array(Ev).catch([]) }).catch({ capital: [], narrative: [], rules: [] }),
  gaps: z.array(z.string()).catch([]),
  triggers: z.array(Cond).catch([]),
  invalidations: z.array(Cond).catch([]),
  risks: z.array(z.string()).catch([]),
  horizonDays: z.number().int().catch(14),
});

/** Words a card never says: probabilities, consensus, price targets, calls. */
const FORBIDDEN = /概率|胜率|共识|已经?定价|price(?:d)? in|目标价|必涨|必跌|稳赚|抄底|梭哈|主力成本|内幕/i;

const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * The kept card, or null with why: nothing to keep (level none), or no reason to watch it left. Sentences
 * with a forbidden word or an ungrounded name or figure are dropped one by one; a condition's own level is
 * grounded by its check.
 */
export function acceptCard(raw: z.infer<typeof CardSchema>, given: CardInput, price: number | null): { card: Card | null; dropped: string[] } {
  const dropped: string[] = [];
  const ok = (text: string, extra = "") => {
    const t = clean(text);
    if (!t) return null;
    if (FORBIDDEN.test(t) || !grounded(t, `${given.corpus} ${extra}`)) {
      dropped.push(t);
      return null;
    }
    return t;
  };
  if (raw.level === "none") return { card: null, dropped };
  const whyNow = ok(raw.whyNow);
  if (!whyNow) return { card: null, dropped: [...dropped, "whyNow"] };
  const evidence = (list: Array<{ claim: string; ref: string }>): Evidence[] => list.flatMap((e) => {
    if (!given.refs.has(e.ref)) {
      dropped.push(`${e.ref}（输入里没有）`);
      return [];
    }
    const claim = ok(e.claim);
    return claim ? [{ claim, ref: e.ref }] : [];
  }).slice(0, 5);
  const conditions = (list: z.infer<typeof Cond>[]): Condition[] => list.flatMap((c) => {
    // A price check stays near the price: a level 10 times away is a typo, not a plan.
    const check = c.check && (price === null || (c.check.value > price / 10 && c.check.value < price * 10)) ? c.check : undefined;
    const text = ok(c.text, check ? String(check.value) : "");
    return text ? [{ text, ...(check ? { check: { metric: "price" as const, op: check.op, value: check.value } } : {}) }] : [];
  }).slice(0, 4);
  const card: Card = {
    level: raw.level,
    whyNow,
    catalysts: raw.catalysts.filter((c) => c.startsWith("e:") && given.refs.has(c)),
    evidence: { capital: evidence(raw.evidence.capital), narrative: evidence(raw.evidence.narrative), rules: evidence(raw.evidence.rules) },
    gaps: raw.gaps.flatMap((g) => ok(g) ?? []).slice(0, 5),
    triggers: conditions(raw.triggers),
    invalidations: conditions(raw.invalidations),
    risks: raw.risks.flatMap((r) => ok(r) ?? []).slice(0, 4),
    horizonDays: Math.min(30, Math.max(3, raw.horizonDays)),
  };
  // Narrative alone, or no way to tell it worked or failed, is a lead at most.
  if (card.level === "candidate" && (!card.evidence.capital.length && !card.evidence.rules.length || !card.triggers.length || !card.invalidations.length)) {
    card.level = "lead";
    dropped.push("降为线索：缺少资金或规则证据，或缺少触发、失效条件");
  }
  return { card, dropped };
}
