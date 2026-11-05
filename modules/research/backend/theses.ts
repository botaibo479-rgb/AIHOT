// The judgment archive. A judgment is never edited: every change is a new revision (its card, a status, a
// review, a note) with when, why and by whom, and the latest one is where it stands. The daily check reads
// prices against the conditions that carry a price level and closes what ran past its horizon; a judgment
// that ends gets a review of how the price went against its benchmark.
import { addDays, beijingDate } from "@aihot/contracts/time";
import { sql, type Db } from "@aihot/backend/db";
import { OPEN_STATUSES, type BriefUpdate, type Card, type Condition, type Review, type Revision, type ThesisStatus, type ThesisView } from "../contract.ts";
import { byId } from "./catalog.ts";

interface RevisionRow { thesis_id: string; rev: number; at: Date; kind: Revision["kind"]; status: ThesisStatus; content: Card | Review | null; reason: string | null; author: Revision["author"]; price: string | null; price_at: Date | null }
interface ThesisRow { id: string; instrument_id: string; origin: ThesisView["origin"]; opened_at: Date }

const toRevision = (r: RevisionRow): Revision => ({
  rev: r.rev, at: r.at.toISOString(), kind: r.kind, status: r.status, content: r.content, reason: r.reason, author: r.author,
  price: r.price === null ? null : Number(r.price), priceAt: r.price_at?.toISOString() ?? null,
});

function view(t: ThesisRow, revisions: Revision[]): ThesisView {
  const card = [...revisions].reverse().find((r) => r.kind === "open" || r.kind === "update")!.content as Card;
  const latest = revisions.at(-1)!;
  return {
    id: Number(t.id), instrument: t.instrument_id, instrumentName: byId(t.instrument_id)?.name ?? t.instrument_id, origin: t.origin,
    openedAt: t.opened_at.toISOString(), status: latest.status, card, revisions, until: addDays(beijingDate(t.opened_at), card.horizonDays),
  };
}

async function load(where: { ids?: number[]; open?: boolean; instrument?: string }): Promise<ThesisView[]> {
  const theses = await sql<ThesisRow[]>`SELECT * FROM research_theses t
    WHERE (${where.ids ?? null}::bigint[] IS NULL OR t.id = ANY(${where.ids ?? null}::bigint[]))
      AND (${where.instrument ?? null}::text IS NULL OR t.instrument_id = ${where.instrument ?? null})
    ORDER BY t.opened_at DESC, t.id DESC`;
  if (!theses.length) return [];
  const revisions = await sql<RevisionRow[]>`SELECT * FROM research_thesis_revisions WHERE thesis_id = ANY(${theses.map((t) => t.id)}::bigint[]) ORDER BY thesis_id, rev`;
  const by = new Map<string, Revision[]>();
  for (const r of revisions) by.set(String(r.thesis_id), [...(by.get(String(r.thesis_id)) ?? []), toRevision(r)]);
  const views = theses.flatMap((t) => (by.get(String(t.id))?.length ? [view(t, by.get(String(t.id))!)] : []));
  return where.open === undefined ? views : views.filter((v) => OPEN_STATUSES.includes(v.status) === where.open);
}

export const getThesis = async (id: number) => (await load({ ids: [id] }))[0] ?? null;
export const listTheses = (filter: { open?: boolean; instrument?: string } = {}) => load(filter);

/** Appends a revision; its number is the next one, taken under the thesis' row lock. */
async function append(tx: Db, thesisId: number, r: Omit<Revision, "rev" | "at" | "priceAt"> & { at: Date; priceAt?: Date | null; receiptId?: number | null }): Promise<void> {
  await tx`SELECT id FROM research_theses WHERE id = ${thesisId} FOR UPDATE`;
  await tx`INSERT INTO research_thesis_revisions (thesis_id, rev, at, kind, status, content, reason, author, receipt_id, price, price_at)
    SELECT ${thesisId}, coalesce(max(rev), 0) + 1, ${r.at}, ${r.kind}, ${r.status}, ${r.content === null ? null : tx.json(r.content as never)}, ${r.reason}, ${r.author},
      ${r.receiptId ?? null}, ${r.price}, ${r.priceAt ?? null}
    FROM research_thesis_revisions WHERE thesis_id = ${thesisId}`;
}

/** Opens a judgment with its card and the price it was opened at. */
export async function openThesis(tx: Db, input: { instrument: string; origin: ThesisView["origin"]; card: Card; reason: string; author: "model" | "owner"; price: number | null; priceAt: Date | null; receiptId?: number | null; now: Date }): Promise<number> {
  const [row] = await tx<{ id: string }[]>`INSERT INTO research_theses (instrument_id, origin, opened_at) VALUES (${input.instrument}, ${input.origin}, ${input.now}) RETURNING id`;
  const id = Number(row!.id);
  await append(tx, id, { kind: "open", status: "watching", content: input.card, reason: input.reason, author: input.author, price: input.price, priceAt: input.priceAt, receiptId: input.receiptId, at: input.now });
  return id;
}

export class ThesisError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The owner's note, or the owner closing it (triggered, invalidated, withdrawn); an ended one takes notes only. */
export async function ownerRevision(id: number, input: { kind: "note" | "status"; status?: ThesisStatus; reason: string }, now = new Date()): Promise<void> {
  const thesis = await getThesis(id);
  if (!thesis) throw new ThesisError(404, "no such judgment");
  const open = OPEN_STATUSES.includes(thesis.status);
  if (input.kind === "status") {
    if (!input.status || !["triggered", "invalidated", "withdrawn", "watching"].includes(input.status)) throw new ThesisError(400, "status must be watching, triggered, invalidated or withdrawn");
    if (!open) throw new ThesisError(409, "the judgment has ended; add a note instead");
  }
  const price = await latestPrice(thesis.instrument);
  await sql.begin(async (tx) => {
    await append(tx, id, { kind: input.kind, status: input.kind === "status" ? input.status! : thesis.status, content: null, reason: input.reason, author: "owner", price: price?.price ?? null, priceAt: price?.at ?? null, at: now });
    if (input.kind === "status" && !OPEN_STATUSES.includes(input.status!)) await appendReview(tx, thesis, input.status!, input.reason, now);
  });
}

// ── The daily check ──────────────────────────────────────────────────────────────────────────────────

/** The latest price the module holds: a snapshot, else the last daily close. */
export async function latestPrice(instrument: string): Promise<{ price: number; at: Date } | null> {
  const [row] = await sql<{ price: string; at: Date }[]>`
    SELECT price, at FROM (
      (SELECT price, at FROM research_quotes WHERE instrument_id = ${instrument} ORDER BY at DESC LIMIT 1)
      UNION ALL (SELECT close, day::timestamptz FROM research_daily WHERE instrument_id = ${instrument} ORDER BY day DESC LIMIT 1)
    ) p ORDER BY at DESC LIMIT 1`;
  return row ? { price: Number(row.price), at: row.at } : null;
}

/** The close of a day or the last one before it. */
async function closeOn(instrument: string, day: string): Promise<number | null> {
  const [row] = await sql<{ close: string }[]>`SELECT close FROM research_daily WHERE instrument_id = ${instrument} AND day <= ${day}::date ORDER BY day DESC LIMIT 1`;
  return row ? Number(row.close) : null;
}

const hits = (c: Condition, price: number) => !!c.check && (c.check.op === ">=" ? price >= c.check.value : price <= c.check.value);
/** Within 3% of a price level, not yet across it. */
const near = (c: Condition, price: number) => !!c.check && !hits(c, price) && Math.abs(price / c.check.value - 1) <= 0.03;

async function appendReview(tx: Db, thesis: ThesisView, ended: ThesisStatus, hit: string | null, now: Date): Promise<void> {
  const opened = thesis.revisions[0]!;
  const close = await latestPrice(thesis.instrument);
  const instrument = byId(thesis.instrument);
  const benchmark = instrument?.market === "crypto" ? "btc" : "spy";
  const from = beijingDate(thesis.openedAt), to = beijingDate(now);
  const [b0, b1] = thesis.instrument === benchmark ? [null, null] : [await closeOn(benchmark, from), await closeOn(benchmark, to)];
  const review: Review = {
    openPrice: opened.price, closePrice: close?.price ?? null,
    change: opened.price && close ? close.price / opened.price - 1 : null,
    benchmark: b0 && b1 ? benchmark : null, benchmarkChange: b0 && b1 ? b1 / b0 - 1 : null,
    hit,
  };
  await append(tx, thesis.id, { kind: "review", status: ended, content: review, reason: `结束：${ended}`, author: "rule", price: close?.price ?? null, priceAt: close?.at ?? null, at: now });
}

/** Reads every open judgment's price against its conditions and horizon; returns what changed. */
export async function checkTheses(now = new Date()): Promise<BriefUpdate[]> {
  const updates: BriefUpdate[] = [];
  const today = beijingDate(now);
  for (const t of await listTheses({ open: true })) {
    const price = await latestPrice(t.instrument);
    let to: ThesisStatus | null = null, reason = "";
    const invalid = price && t.card.invalidations.find((c) => hits(c, price.price));
    const trigger = price && t.card.triggers.find((c) => hits(c, price.price));
    if (invalid) [to, reason] = ["invalidated", `失效条件成立：${invalid.text}`];
    else if (trigger) [to, reason] = ["triggered", `触发条件成立：${trigger.text}`];
    else if (today > t.until) [to, reason] = ["expired", `观察期到 ${t.until} 结束`];
    else if (t.status === "watching" && price && t.card.triggers.some((c) => near(c, price.price))) [to, reason] = ["near", `价格离触发价不到 3%：${t.card.triggers.find((c) => near(c, price.price))!.text}`];
    if (!to) continue;
    await sql.begin(async (tx) => {
      await append(tx, t.id, { kind: "status", status: to!, content: null, reason, author: "rule", price: price?.price ?? null, priceAt: price?.at ?? null, at: now });
      if (!OPEN_STATUSES.includes(to!)) await appendReview(tx, t, to!, reason, now);
    });
    updates.push({ thesisId: t.id, instrument: t.instrument, instrumentName: t.instrumentName, from: t.status, to, reason });
  }
  return updates;
}

