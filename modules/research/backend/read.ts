// What the module answers about its instruments: the latest price and its moves, the perpetual contract's
// numbers, how many sources are reporting on it, its watch state and the screening flags. Read from the
// stored quotes and the public reports (the engine's public scope), never from a source while a reader waits.
import { sql } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";
import { FLAG_NOTE, type AttentionView, type DailyPoint, type Flag, type InstrumentDetail, type InstrumentList, type InstrumentView, type QuoteView, type WatchState } from "../contract.ts";
import { CATALOG, byId, topicOf, type Instrument } from "./catalog.ts";
import { upcomingByEntity } from "./events.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

interface SnapshotRow { instrument_id: string; at: Date; source: string; price: string; change_24h: string | null; quote_volume_24h: string | null; funding_rate: string | null; open_interest: string | null; mark_price: string | null; index_price: string | null }
interface DailyRow { instrument_id: string; day: string; close: string; volume: string | null; open_interest: string | null }
interface WatchRow { instrument_id: string; state: WatchState; reason: string | null; changed_by: "auto" | "owner"; changed_at: Date }

/** Per entity: distinct sources and reports in [now − hours, now), and the distinct sources of the window before. */
export async function attentionByEntity(now: Date, hours: number): Promise<Map<string, { sources: number; previous: number; reports: number }>> {
  const entities = [...new Set(CATALOG.instruments.flatMap((i) => (i.entityId ? [`entity:${i.entityId}`] : [])))];
  if (!entities.length) return new Map();
  const start = new Date(now.getTime() - hours * HOUR);
  const before = new Date(now.getTime() - 2 * hours * HOUR);
  const rows = await sql<{ tag: string; sources: number; previous: number; reports: number }[]>`
    SELECT t.tag,
      count(DISTINCT p.source_id) FILTER (WHERE p.timeline_at >= ${start})::int AS sources,
      count(DISTINCT p.source_id) FILTER (WHERE p.timeline_at < ${start})::int AS previous,
      count(*) FILTER (WHERE p.timeline_at >= ${start})::int AS reports
    FROM publications p CROSS JOIN LATERAL unnest(p.tags) AS t(tag)
    WHERE ${listedCondition(now)} AND t.tag = ANY(${entities}::text[]) AND p.timeline_at >= ${before} AND p.timeline_at < ${now}
    GROUP BY t.tag`;
  return new Map(rows.map((r) => [r.tag.slice("entity:".length), { sources: r.sources, previous: r.previous, reports: r.reports }]));
}

function quoteLabels(i: Instrument): { price: string; perp: string; unit: string | null } {
  const q = i.quote!;
  if (q.source === "binance") return { price: `Binance 现货 ${q.symbol}`, perp: `Binance USDT 永续 ${q.symbol}`, unit: "USDT" };
  if (q.source === "okx") return { price: `OKX 现货 ${q.symbol}`, perp: `OKX 永续 ${q.symbol}-SWAP`, unit: "USDT" };
  if (q.source === "twelvedata") return { price: `Twelve Data 日线收盘 ${q.symbol}`, perp: "", unit: "美元" };
  return { price: `FRED ${q.symbol}（日值）`, perp: "", unit: i.unit ?? null };
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** The last close at least `days` before `ref` (a UTC day). */
function closeBefore(series: DailyRow[], ref: string, days: number): DailyRow | null {
  const limit = dayMs(ref) - days * DAY;
  for (let k = series.length - 1; k >= 0; k--) if (dayMs(series[k]!.day) <= limit) return series[k]!;
  return null;
}

function volatility(series: DailyRow[]): number | null {
  const closes = series.slice(-31).map((d) => Number(d.close));
  if (closes.length < 11) return null;
  const returns = closes.slice(1).map((c, k) => Math.log(c / closes[k]!));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  return Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1));
}

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function quoteView(i: Instrument, snap: SnapshotRow | undefined, series: DailyRow[], now: Date): QuoteView | null {
  const labels = quoteLabels(i);
  const last = series.at(-1);
  const rate = labels.unit === "%";
  const priorVolumes = (rows: DailyRow[]) => average(rows.slice(-20).flatMap((d) => (d.volume === null ? [] : [Number(d.volume)])));
  let price: number, at: Date, change1d: number | null, points1d: number | null = null, ref: string, volumeRatio: number | null;
  if (snap) {
    price = Number(snap.price);
    at = snap.at;
    change1d = n(snap.change_24h);
    ref = at.toISOString().slice(0, 10);
    const avg = priorVolumes(series);
    volumeRatio = snap.quote_volume_24h !== null && avg ? Number(snap.quote_volume_24h) / avg : null;
  } else if (last) {
    const prev = series.at(-2);
    price = Number(last.close);
    at = new Date(dayMs(last.day));
    change1d = prev && !rate ? price / Number(prev.close) - 1 : null;
    points1d = prev && rate ? price - Number(prev.close) : null;
    ref = last.day;
    const avg = priorVolumes(series.slice(0, -1));
    volumeRatio = last.volume !== null && avg ? Number(last.volume) / avg : null;
  } else return null;
  const week = closeBefore(series, ref, 7);
  const perp = snap && (snap.funding_rate !== null || snap.open_interest !== null) ? (() => {
    const withOi = series.filter((d) => d.open_interest !== null);
    const latestOi = withOi.at(-1);
    const weekOi = latestOi ? closeBefore(withOi, latestOi.day, 7) : null;
    const mark = n(snap.mark_price), index = n(snap.index_price);
    return {
      label: labels.perp,
      fundingRate: n(snap.funding_rate),
      openInterest: n(snap.open_interest),
      openInterestChange7d: latestOi && weekOi ? Number(latestOi.open_interest) / Number(weekOi.open_interest) - 1 : null,
      basis: mark !== null && index ? mark / index - 1 : null,
    };
  })() : null;
  return {
    label: labels.price, price, at: at.toISOString(), daily: !snap, unit: labels.unit,
    change1d: rate ? null : change1d,
    change7d: week && !rate ? price / Number(week.close) - 1 : null,
    changePoints1d: points1d,
    changePoints7d: week && rate ? price - Number(week.close) : null,
    volatility30d: volatility(series), volumeRatio, perp,
    stale: now.getTime() - at.getTime() > (snap ? HOUR : 5 * DAY),
  };
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/** The screening rules (instruments.json signals): plain thresholds, said as such. */
export function flagsOf(quote: QuoteView | null, attention: AttentionView | null): Flag[] {
  const s = CATALOG.signals;
  const flags: Flag[] = [];
  const capital: string[] = [];
  const oi = quote?.perp?.openInterestChange7d ?? null;
  if (oi !== null && Math.abs(oi) >= s.oiChange7d) capital.push(`未平仓量 7 日 ${pct(oi)}`);
  if (quote?.volumeRatio != null && quote.volumeRatio >= s.volumeRatio) capital.push(`成交额是近 20 日均值的 ${quote.volumeRatio.toFixed(1)} 倍`);
  const funding = quote?.perp?.fundingRate ?? null;
  if (funding !== null && Math.abs(funding) >= s.fundingRate) capital.push(`资金费率 ${(funding * 100).toFixed(4)}%/8h`);
  if (capital.length) flags.push({ key: "capital", label: "资金异动", detail: capital.join("；") });
  const sources = attention?.sources48h ?? 0;
  if (capital.length && sources <= s.quietSources) flags.push({ key: "capital_quiet", label: "资金先动，讨论未扩散", detail: `48 小时内 ${sources} 个来源报道` });
  const previous = attention?.sourcesPrev48h ?? 0;
  if (sources >= s.attentionSources && sources > previous) {
    flags.push({ key: "attention_rising", label: "传播在扩散", detail: `48 小时内 ${sources} 个来源报道，此前 48 小时 ${previous} 个` });
    const move = quote?.change1d ?? null;
    if (move !== null && Math.abs(move) < s.flatMove24h) flags.push({ key: "spread_no_move", label: "传播扩散，价格未明显反应", detail: `24 小时 ${pct(move)}` });
  }
  return flags;
}

async function load(now: Date, ids?: string[]) {
  const instruments = ids ? CATALOG.instruments.filter((i) => ids.includes(i.id)) : CATALOG.instruments;
  const list = instruments.map((i) => i.id);
  const [snaps, days, watch, attention, upcoming] = await Promise.all([
    sql<SnapshotRow[]>`SELECT DISTINCT ON (instrument_id) * FROM research_quotes WHERE instrument_id = ANY(${list}::text[]) ORDER BY instrument_id, at DESC`,
    sql<DailyRow[]>`SELECT instrument_id, day::text AS day, close, volume, open_interest FROM (
        SELECT *, row_number() OVER (PARTITION BY instrument_id ORDER BY day DESC) AS k FROM research_daily WHERE instrument_id = ANY(${list}::text[])) d
      WHERE k <= 41 ORDER BY instrument_id, day`,
    sql<WatchRow[]>`SELECT * FROM research_watch WHERE instrument_id = ANY(${list}::text[])`,
    attentionByEntity(now, 48),
    upcomingByEntity(now),
  ]);
  const series = new Map<string, DailyRow[]>();
  for (const d of days) series.set(d.instrument_id, [...(series.get(d.instrument_id) ?? []), d]);
  const snapBy = new Map(snaps.map((s) => [s.instrument_id, s]));
  const watchBy = new Map(watch.map((w) => [w.instrument_id, w]));
  return instruments.map((i) => {
    const rows = series.get(i.id) ?? [];
    const quote = i.quote ? quoteView(i, snapBy.get(i.id), rows, now) : null;
    const counted = i.entityId ? attention.get(i.entityId) : undefined;
    const seen: AttentionView | null = i.entityId ? { sources48h: counted?.sources ?? 0, sourcesPrev48h: counted?.previous ?? 0, reports48h: counted?.reports ?? 0 } : null;
    const w = watchBy.get(i.id);
    const view: InstrumentView = {
      id: i.id, name: i.name, market: i.market, kind: i.kind, role: i.role, entityId: i.entityId, topic: topicOf(i.entityId),
      watch: w ? { state: w.state, reason: w.reason, by: w.changed_by, at: w.changed_at.toISOString() } : null,
      quote,
      quoteNote: !i.quote ? "行情还没接入（港股行情在后续阶段）" : quote ? null : "还没有取到行情",
      attention: seen,
      flags: flagsOf(quote, seen),
      upcoming: i.entityId ? upcoming.get(i.entityId) ?? [] : [],
    };
    return { view, rows };
  });
}

export async function listInstruments(now = new Date()): Promise<InstrumentList> {
  return { generatedAt: now.toISOString(), flagNote: FLAG_NOTE, instruments: (await load(now)).map((r) => r.view) };
}

/** One instrument by its id, its symbol or a name it goes by. */
export async function instrumentDetail(query: string, now = new Date()): Promise<InstrumentDetail | null> {
  const instrument = resolveInstrument(query);
  if (!instrument) return null;
  const [found] = await load(now, [instrument.id]);
  const daily: DailyPoint[] = found!.rows.slice(-30).map((d) => ({ day: d.day, close: Number(d.close), volume: n(d.volume), openInterest: n(d.open_interest) }));
  return { ...found!.view, generatedAt: now.toISOString(), flagNote: FLAG_NOTE, daily };
}

/** An instrument by its id, its symbol, or a name it goes by (MCP and Agent questions). */
function resolveInstrument(query: string): Instrument | null {
  const q = query.trim().toLowerCase();
  return byId(q) ?? CATALOG.instruments.find((i) => i.quote?.symbol.toLowerCase() === q || i.quote?.symbol.toLowerCase().replace(/-?usdt$/, "") === q || i.name.toLowerCase().includes(q)) ?? null;
}
