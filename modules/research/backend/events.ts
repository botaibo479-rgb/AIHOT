// The event calendar: the owner's official calendar (calendar.json), events the catalyst step reads out of
// public reports, and events the owner adds. An event read from several reports is one event: the same
// date and precision about at least one same entity merges into it, keeping every report it came from and
// the firmest confirmation any of them gave. Nothing is overwritten by a weaker report, and nothing is
// deleted: a wrong event is withdrawn with a reason.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { addDays, beijingDate } from "@aihot/contracts/time";
import { sql, type Db } from "@aihot/backend/db";
import { modelRoute } from "@aihot/backend/editorial/models";
import { promptText, promptVersion } from "@aihot/backend/editorial/prompts";
import { chatJson } from "@aihot/backend/providers/llm";
import { completeReceipt, failureKind } from "@aihot/backend/providers/receipts";
import { listedCondition } from "@aihot/backend/publication/scope";
import { ENTITIES } from "@aihot/industry/taxonomy";
import { SELECTION } from "@aihot/industry/selection";
import { EVENT_NOTE, type Confirmation, type DatePrecision, type EventList, type EventView } from "../contract.ts";
import { CATALOG } from "./catalog.ts";

const RANK: Record<Confirmation, number> = { speculative: 0, tentative: 1, official: 2 };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── The official calendar ────────────────────────────────────────────────────────────────────────────

const CalendarEntry = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(80),
  date: z.string().regex(DATE),
  entities: z.array(z.string()),
  confirmation: z.enum(["official", "tentative"]),
  url: z.string().url(),
});

export function parseCalendar(json: unknown) {
  const entries = z.strictObject({ $comment: z.string().optional(), events: z.array(CalendarEntry) }).parse(json).events;
  for (const e of entries) for (const id of e.entities) if (!ENTITIES[id]) throw new Error(`calendar.json: ${e.key} names entity ${id}, which industry/taxonomy.ts does not list`);
  if (new Set(entries.map((e) => e.key)).size !== entries.length) throw new Error("calendar.json: a key is listed twice");
  return entries;
}

const CALENDAR = parseCalendar(JSON.parse(readFileSync(new URL("../calendar.json", import.meta.url), "utf8")));

/** Writes calendar.json into the table: new keys added, changed ones updated, removed ones withdrawn. */
export async function syncCalendar(now = new Date()): Promise<{ calendar: number }> {
  for (const e of CALENDAR) {
    await sql`INSERT INTO research_events (key, title, entity_ids, starts_on, date_precision, confirmation, origin, url, created_at, updated_at)
      VALUES (${e.key}, ${e.title}, ${e.entities}, ${e.date}, 'day', ${e.confirmation}, 'calendar', ${e.url}, ${now}, ${now})
      ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, entity_ids = EXCLUDED.entity_ids, starts_on = EXCLUDED.starts_on,
        confirmation = EXCLUDED.confirmation, url = EXCLUDED.url, withdrawn_at = NULL, withdrawn_reason = NULL, updated_at = EXCLUDED.updated_at
      WHERE (research_events.title, research_events.entity_ids, research_events.starts_on, research_events.confirmation, research_events.url, research_events.withdrawn_at IS NULL)
        IS DISTINCT FROM (EXCLUDED.title, EXCLUDED.entity_ids, EXCLUDED.starts_on, EXCLUDED.confirmation, EXCLUDED.url, true)`;
  }
  await sql`UPDATE research_events SET withdrawn_at = ${now}, withdrawn_reason = '已从 calendar.json 删除', updated_at = ${now}
    WHERE origin = 'calendar' AND withdrawn_at IS NULL AND NOT (key = ANY(${CALENDAR.map((e) => e.key)}::text[]))`;
  return { calendar: CALENDAR.length };
}

// ── Events read out of public reports ────────────────────────────────────────────────────────────────

const ModelEvent = z.object({
  title: z.string(),
  entities: z.array(z.string()).catch([]),
  date: z.string().nullable().catch(null),
  precision: z.enum(["day", "month", "quarter", "unknown"]).catch("unknown"),
  confirmation: z.enum(["official", "tentative", "speculative"]),
  quote: z.string(),
});
const CatalystSchema = z.object({ events: z.array(ModelEvent).max(10) });

export interface Candidate {
  title: string;
  entities: string[];
  startsOn: string | null;
  precision: DatePrecision;
  confirmation: Confirmation;
  quote: string;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * What of the model's answer can be kept: a quote found word for word in the report, known entities, a real
 * date that is not in the past (an event without a date keeps its place only as a guess or a plan).
 */
export function acceptEvents(events: z.infer<typeof ModelEvent>[], original: string, today: string): Candidate[] {
  const text = squash(original);
  return events.flatMap((e) => {
    const quote = squash(e.quote);
    const title = squash(e.title).slice(0, 60);
    if (!title || quote.length < 6 || quote.length > 400 || !text.includes(quote)) return [];
    const entities = [...new Set(e.entities.filter((id) => ENTITIES[id]))];
    const startsOn = e.precision === "unknown" ? null : periodStart(e.date, e.precision);
    if (startsOn && !stillAhead(startsOn, e.precision, today)) return [];
    // An official schedule has a date.
    const confirmation: Confirmation = !startsOn && e.confirmation === "official" ? "tentative" : e.confirmation;
    return [{ title, entities, startsOn, precision: startsOn ? e.precision : "unknown", confirmation, quote }];
  });
}

/** The first day of the date's day, month or quarter; null for anything that is not a real date. */
function periodStart(date: string | null, precision: DatePrecision): string | null {
  if (!date || !DATE.test(date)) return null;
  const real = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== date) return null;
  const [y, m] = [date.slice(0, 4), Number(date.slice(5, 7))];
  if (precision === "month") return `${y}-${String(m).padStart(2, "0")}-01`;
  if (precision === "quarter") return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  return date;
}

/** Whether a day, month or quarter starting on `start` has not ended before `today`. */
function stillAhead(start: string, precision: DatePrecision, today: string): boolean {
  if (precision === "day") return start >= today;
  const months = precision === "quarter" ? 3 : 1;
  const [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  const end = new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
  return end > today;
}

/** Adds a candidate, or merges it into the same event read from another report. */
export async function saveCandidate(tx: Db, c: Candidate, articleId: string, url: string, receiptId: number, now: Date): Promise<void> {
  const [same] = c.startsOn && c.entities.length
    ? await tx<{ id: number; confirmation: Confirmation }[]>`SELECT id, confirmation FROM research_events
        WHERE withdrawn_at IS NULL AND starts_on = ${c.startsOn} AND date_precision = ${c.precision} AND entity_ids && ${c.entities}::text[]
        ORDER BY id LIMIT 1`
    : await tx<{ id: number; confirmation: Confirmation }[]>`SELECT id, confirmation FROM research_events
        WHERE withdrawn_at IS NULL AND starts_on IS NULL AND origin = 'article' AND title = ${c.title} ORDER BY id LIMIT 1`;
  if (same) {
    const firmer = RANK[c.confirmation] > RANK[same.confirmation];
    await tx`UPDATE research_events SET
        article_ids = CASE WHEN ${articleId} = ANY(article_ids) THEN article_ids ELSE article_ids || ${articleId}::text END,
        receipt_ids = CASE WHEN ${receiptId}::bigint = ANY(receipt_ids) THEN receipt_ids ELSE receipt_ids || ${receiptId}::bigint END,
        entity_ids = ARRAY(SELECT DISTINCT unnest(entity_ids || ${c.entities}::text[])),
        confirmation = ${firmer ? c.confirmation : same.confirmation},
        quote = CASE WHEN ${firmer} THEN ${c.quote} ELSE quote END,
        url = CASE WHEN ${firmer} THEN ${url} ELSE COALESCE(url, ${url}) END,
        updated_at = ${now}
      WHERE id = ${same.id}`;
    return;
  }
  await tx`INSERT INTO research_events (title, entity_ids, starts_on, date_precision, confirmation, origin, url, quote, article_ids, receipt_ids, created_at, updated_at)
    VALUES (${c.title}, ${c.entities}, ${c.startsOn}, ${c.precision}, ${c.confirmation}, 'article', ${url}, ${c.quote}, ${[articleId]}, ${[receiptId]}, ${now}, ${now})`;
}

const entityList = () => Object.entries(ENTITIES).map(([id, e]) => `${id}（${e.name}）`).join("、");

interface ScanRow { id: string; revision: number; title: string; summary: string | null; body: string | null; url: string; published_at: Date | null; timeline_at: Date }

/**
 * Reads the public reports of the last three days that were selected or nearly so, once per revision. Stops
 * at the first failure that is not the report's (model calls off, budget, provider down): the next run goes on.
 */
export async function scanReports(now = new Date(), limit = 20): Promise<{ read: number; events: number; stopped?: string }> {
  await syncCalendar(now);
  const rows = await sql<ScanRow[]>`
    SELECT a.id, a.revision, a.title, p.summary, coalesce(a.body_text, a.excerpt) AS body, p.url, a.published_at, p.timeline_at
    FROM publications p JOIN articles a ON a.id = p.article_id
    WHERE ${listedCondition(now)} AND p.timeline_at >= ${new Date(now.getTime() - 3 * 86_400_000)}
      AND (p.selected OR p.score >= ${SELECTION.understandFloor})
      AND NOT EXISTS (SELECT 1 FROM research_article_scans s WHERE s.article_id = a.id AND s.revision = a.revision)
    ORDER BY p.timeline_at DESC LIMIT ${limit}`;
  if (!rows.length) return { read: 0, events: 0 };
  const { model, fallbackModel } = await modelRoute("catalyst");
  const today = beijingDate(now);
  const system = promptText("research-catalyst", { today, entities: entityList() });
  const version = promptVersion("research-catalyst");
  let read = 0, events = 0;
  for (const r of rows) {
    const original = [r.title, r.body ?? ""].join("\n");
    const user = JSON.stringify({ title: r.title, published: r.published_at ? beijingDate(r.published_at) : beijingDate(r.timeline_at), summaryZh: r.summary, text: (r.body ?? "").slice(0, 8000) });
    try {
      const res = await chatJson({ model, fallbackModel, purpose: "research_catalyst", subject: r.id, promptVersion: version, system, user, schema: CatalystSchema, temperature: 0, maxTokens: 2000 });
      const found = acceptEvents(res.data.events, original, today);
      await sql.begin(async (tx) => {
        for (const c of found) await saveCandidate(tx, c, r.id, r.url, res.receiptId, now);
        await tx`INSERT INTO research_article_scans (article_id, revision, status, events, scanned_at) VALUES (${r.id}, ${r.revision}, 'done', ${found.length}, ${now}) ON CONFLICT DO NOTHING`;
        await completeReceipt(tx, res.receiptId);
      });
      read += 1;
      events += found.length;
    } catch (error) {
      const kind = failureKind(error);
      if (kind === "unusable" || kind === "refused") {
        await sql`INSERT INTO research_article_scans (article_id, revision, status, events, scanned_at) VALUES (${r.id}, ${r.revision}, 'invalid', 0, ${now}) ON CONFLICT DO NOTHING`;
        continue;
      }
      if (kind === "other") throw error;
      return { read, events, stopped: `${kind}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) };
    }
  }
  return { read, events };
}

// ── The owner's events ───────────────────────────────────────────────────────────────────────────────

export const OwnerEvent = z.strictObject({
  title: z.string().trim().min(1).max(60),
  date: z.string().regex(DATE).nullable().optional(),
  precision: z.enum(["day", "month", "quarter", "unknown"]).optional(),
  confirmation: z.enum(["official", "tentative", "speculative"]),
  entities: z.array(z.string()).max(10).default([]),
  url: z.string().url().max(500).optional(),
  note: z.string().trim().max(300).optional(),
});

export async function addOwnerEvent(input: z.infer<typeof OwnerEvent>, now = new Date()): Promise<number> {
  const unknown = input.entities.filter((id) => !ENTITIES[id]);
  if (unknown.length) throw new RangeError(`unknown entities: ${unknown.join(", ")}`);
  const precision = input.date ? input.precision ?? "day" : "unknown";
  if (!input.date && input.confirmation === "official") throw new RangeError("an official event needs a date");
  const [row] = await sql<{ id: number }[]>`INSERT INTO research_events (title, entity_ids, starts_on, date_precision, confirmation, origin, url, quote, created_at, updated_at)
    VALUES (${input.title}, ${input.entities}, ${input.date ?? null}, ${precision}, ${input.confirmation}, 'owner', ${input.url ?? null}, ${input.note ?? null}, ${now}, ${now}) RETURNING id`;
  return row!.id;
}

/** Takes an event off the calendar, keeping it and why. False when there is no such event on it. */
export async function withdrawEvent(id: number, reason: string, now = new Date()): Promise<boolean> {
  const rows = await sql`UPDATE research_events SET withdrawn_at = ${now}, withdrawn_reason = ${reason}, updated_at = ${now} WHERE id = ${id} AND withdrawn_at IS NULL`;
  return rows.count > 0;
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────

interface EventRow { id: number; title: string; entity_ids: string[]; starts_on: string | null; date_precision: DatePrecision; confirmation: Confirmation; origin: EventView["origin"]; url: string | null; quote: string | null; article_ids: string[] }

const instrumentsOf = (entities: string[]) => CATALOG.instruments.filter((i) => i.entityId && entities.includes(i.entityId)).map((i) => i.id);

const toView = (r: EventRow): EventView => ({
  id: Number(r.id), title: r.title, entities: r.entity_ids, instruments: instrumentsOf(r.entity_ids), startsOn: r.starts_on, precision: r.date_precision,
  confirmation: r.confirmation, origin: r.origin, url: r.url, quote: r.quote, articles: r.article_ids,
});

/**
 * Events from `from` to `to` (Beijing dates), the firmest first, then by date. A month or quarter counts from
 * its first day. Guesses without a date come along while their reports are recent (14 days).
 */
export async function listEvents(opts: { now?: Date; days?: number; entity?: string | null } = {}): Promise<EventList> {
  const now = opts.now ?? new Date();
  const from = beijingDate(now);
  const to = addDays(from, opts.days ?? 21);
  // A month or quarter that began before today is still ahead in part.
  const windowStart = `${from.slice(0, 4)}-01-01`;
  const rows = await sql<EventRow[]>`
    SELECT id, title, entity_ids, starts_on::text AS starts_on, date_precision, confirmation, origin, url, quote, article_ids FROM research_events
    WHERE withdrawn_at IS NULL AND (${opts.entity ?? null}::text IS NULL OR ${opts.entity ?? null}::text = ANY(entity_ids))
      AND ((starts_on IS NULL AND created_at >= ${new Date(now.getTime() - 14 * 86_400_000)})
        OR (date_precision = 'day' AND starts_on BETWEEN ${from}::date AND ${to}::date)
        OR (date_precision = 'month' AND starts_on BETWEEN ${windowStart}::date AND ${to}::date AND starts_on + interval '1 month' > ${from}::date)
        OR (date_precision = 'quarter' AND starts_on BETWEEN ${windowStart}::date AND ${to}::date AND starts_on + interval '3 months' > ${from}::date))
    ORDER BY starts_on NULLS LAST, id`;
  const views = rows.map(toView);
  return {
    generatedAt: now.toISOString(), from, to, note: EVENT_NOTE,
    official: views.filter((v) => v.confirmation === "official"),
    tentative: views.filter((v) => v.confirmation === "tentative"),
    speculative: views.filter((v) => v.confirmation === "speculative"),
  };
}

/** Every dated event of the next 21 days by entity, the official first: for the instruments' views. */
export async function upcomingByEntity(now: Date): Promise<Map<string, EventView[]>> {
  const list = await listEvents({ now });
  const out = new Map<string, EventView[]>();
  for (const v of [...list.official, ...list.tentative, ...list.speculative]) {
    if (!v.startsOn) continue;
    for (const id of v.entities) out.set(id, [...(out.get(id) ?? []), v]);
  }
  return out;
}
