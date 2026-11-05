// What the research module's JSON answers carry (backend/read.ts → /api/research/*, the topic page part, the
// watchlist page), and the few ways the page and the Markdown answers write its numbers.

export type Market = "crypto" | "equities" | "commodities" | "fx" | "macro";
export type Kind = "crypto" | "stock" | "etf" | "index" | "rate" | "fx" | "commodity-spot";
export type WatchState = "nominated" | "watching" | "dropped";

export interface PerpView {
  /** Where the contract trades: "Binance USDT 永续 BTCUSDT". */
  label: string;
  /** Per funding interval (8 hours on both venues), as a fraction. */
  fundingRate: number | null;
  /** In the contract's coin. */
  openInterest: number | null;
  /** Against the open interest of the daily close 7 days before, as a fraction. */
  openInterestChange7d: number | null;
  /** (mark − index) / index. */
  basis: number | null;
}

export interface QuoteView {
  /** What the price is: "Binance 现货 BTCUSDT", "FRED DGS10（日值）". */
  label: string;
  price: number;
  /** When the source gave it (a daily value: its date at 00:00 UTC). */
  at: string;
  /** A snapshot (crypto) or a daily value (the rest). */
  daily: boolean;
  unit: string | null;
  /** 24 hours for a snapshot, the previous value for a daily series. As a fraction; null for rates. */
  change1d: number | null;
  change7d: number | null;
  /** Rates and yields move in points, not percent: their changes in their own unit (null for the rest). */
  changePoints1d: number | null;
  changePoints7d: number | null;
  /** Standard deviation of the last 30 daily log returns. */
  volatility30d: number | null;
  /** The latest day's volume against the average of the 20 days before. */
  volumeRatio: number | null;
  perp: PerpView | null;
  /** Older than the source's rhythm allows (a snapshot over an hour, a daily value over 4 days). */
  stale: boolean;
}

export interface AttentionView {
  /** Distinct sources of the public reports about it (its entity tag) in the last 48 hours, and the 48 before. */
  sources48h: number;
  sourcesPrev48h: number;
  reports48h: number;
}

export interface Flag {
  key: "capital" | "capital_quiet" | "attention_rising" | "spread_no_move";
  label: string;
  detail: string;
}

export interface InstrumentView {
  id: string;
  name: string;
  market: Market;
  kind: Kind;
  role: "candidate" | "context";
  entityId: string | null;
  /** Its topic page, when its entity has one. */
  topic: string | null;
  watch: { state: WatchState; reason: string | null; by: "auto" | "owner"; at: string } | null;
  quote: QuoteView | null;
  /** Why there is no quote: no source yet (港股) or no key. */
  quoteNote: string | null;
  attention: AttentionView | null;
  flags: Flag[];
  /** Its entity's events from today to 21 days ahead, the official first. */
  upcoming: EventView[];
}

export interface InstrumentList {
  generatedAt: string;
  /** Said with every list of flags: they are screening rules, not tested strategies. */
  flagNote: string;
  instruments: InstrumentView[];
}

export interface DailyPoint {
  day: string;
  close: number;
  volume: number | null;
  openInterest: number | null;
}

export interface InstrumentDetail extends InstrumentView {
  generatedAt: string;
  flagNote: string;
  /** The last 30 daily values, oldest first. */
  daily: DailyPoint[];
}

export type Confirmation = "official" | "tentative" | "speculative";
export type DatePrecision = "day" | "month" | "quarter" | "unknown";

export interface EventView {
  id: number;
  title: string;
  /** Entities (industry/taxonomy.ts) and the module's instruments of those entities. */
  entities: string[];
  instruments: string[];
  /** YYYY-MM-DD; with a month or quarter precision, its first day. Null: no date. */
  startsOn: string | null;
  precision: DatePrecision;
  confirmation: Confirmation;
  origin: "calendar" | "article" | "owner";
  url: string | null;
  /** The sentence of the report that supports it, as written. */
  quote: string | null;
  /** The public reports it was read from (article ids). */
  articles: string[];
}

export interface EventList {
  generatedAt: string;
  from: string;
  to: string;
  note: string;
  official: EventView[];
  tentative: EventView[];
  /** Guesses, dated or not: never a schedule. */
  speculative: EventView[];
}

export const EVENT_NOTE = "正式日程是机构已公布的日期；暂定安排是计划、预计或机构自己标为暂定的日期；研究推测只是有人这样猜，不是日程。这里不给概率，也不说“已经定价”。";
export const CONFIRMATION_LABELS: Record<Confirmation, string> = { official: "正式", tentative: "暂定", speculative: "推测" };

/** "12 月 9 日", "2027 年 1 月", "2027 年第 1 季度", "日期未定". */
export function formatEventDate(e: Pick<EventView, "startsOn" | "precision">): string {
  if (!e.startsOn || e.precision === "unknown") return "日期未定";
  const [y, m, d] = e.startsOn.split("-").map(Number) as [number, number, number];
  if (e.precision === "quarter") return `${y} 年第 ${Math.floor((m - 1) / 3) + 1} 季度`;
  if (e.precision === "month") return `${y} 年 ${m} 月`;
  return `${y} 年 ${m} 月 ${d} 日`;
}

export const FLAG_NOTE = "标记是按固定阈值筛出来的“值得看一眼”，不是验证过的交易信号；资金变化不等于买卖方向。";

export const MARKET_LABELS: Record<Market, string> = { crypto: "加密", equities: "美股港股", commodities: "黄金原油", fx: "外汇", macro: "宏观" };
export const WATCH_LABELS: Record<WatchState, string> = { nominated: "已提名，等你确认", watching: "观察中", dropped: "已放弃" };

/** A price with as many digits as it needs: 4 significant ones at least, never more than 6 decimals. */
export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : Math.min(6, Math.max(2, 3 - Math.floor(Math.log10(abs || 1))));
  return Number(value.toFixed(decimals)).toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/** "+1.23%" from a fraction. */
export function formatPercent(value: number | null, digits = 2): string {
  if (value === null) return "—";
  const pct = value * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

/** The day's move in the way its kind is read: points for a rate, percent for the rest. */
export function formatMove(q: QuoteView, which: "1d" | "7d"): string {
  if (q.unit === "%") {
    const points = which === "1d" ? q.changePoints1d : q.changePoints7d;
    return points === null ? "—" : `${points > 0 ? "+" : ""}${points.toFixed(2)} 个百分点`;
  }
  return formatPercent(which === "1d" ? q.change1d : q.change7d);
}

// ── Candidate cards, judgments and the daily brief (backend/cards.ts, theses.ts, brief.ts) ────────────

export interface Evidence {
  claim: string;
  /** What supports it: a metric of the instrument (quote.change7d), a report (a:<id>) or an event (e:<id>). */
  ref: string;
}

export interface Condition {
  text: string;
  /** A price level the daily check reads; without one the condition is checked by hand. */
  check?: { metric: "price"; op: ">=" | "<="; value: number };
}

export interface Card {
  level: "candidate" | "lead";
  whyNow: string;
  catalysts: string[];
  evidence: { capital: Evidence[]; narrative: Evidence[]; rules: Evidence[] };
  gaps: string[];
  triggers: Condition[];
  invalidations: Condition[];
  risks: string[];
  horizonDays: number;
}

export type ThesisStatus = "watching" | "near" | "triggered" | "invalidated" | "expired" | "withdrawn";
export const OPEN_STATUSES: readonly ThesisStatus[] = ["watching", "near"];
export const STATUS_LABELS: Record<ThesisStatus, string> = { watching: "观察中", near: "接近触发", triggered: "已触发", invalidated: "已失效", expired: "到期", withdrawn: "撤销" };

export interface Review {
  /** The price when it was opened and when it ended, and the change between them. */
  openPrice: number | null;
  closePrice: number | null;
  change: number | null;
  /** The benchmark's change over the same days (BTC for crypto, SPY for the rest), when both were known. */
  benchmark: string | null;
  benchmarkChange: number | null;
  /** The condition that ended it, as written. */
  hit: string | null;
}

export interface Revision {
  rev: number;
  at: string;
  kind: "open" | "update" | "status" | "review" | "note";
  status: ThesisStatus;
  /** A card (open, update), a review, or nothing. */
  content: Card | Review | null;
  reason: string | null;
  author: "model" | "rule" | "owner";
  price: number | null;
  priceAt: string | null;
}

export interface ThesisView {
  id: number;
  instrument: string;
  instrumentName: string;
  origin: "brief" | "owner";
  openedAt: string;
  status: ThesisStatus;
  /** The card as it stands: the latest open or update revision. */
  card: Card;
  /** Every revision, oldest first, as written. */
  revisions: Revision[];
  /** The last day to watch it. */
  until: string;
}

export interface BriefEntry {
  instrument: InstrumentView;
  card: Card;
  /** The judgment it opened (candidates only). */
  thesisId: number | null;
}

export interface BriefUpdate {
  thesisId: number;
  instrument: string;
  instrumentName: string;
  from: ThesisStatus;
  to: ThesisStatus;
  reason: string;
}

export interface Brief {
  day: string;
  generatedAt: string;
  note: string;
  candidates: BriefEntry[];
  leads: BriefEntry[];
  updates: BriefUpdate[];
  /** Judgments still open after today's check, other than today's new ones. */
  open: Array<{ thesisId: number; instrument: string; instrumentName: string; status: ThesisStatus; until: string }>;
  events: EventList;
  watchlist: InstrumentView[];
  context: InstrumentView[];
  /** What failed while writing it (a model call, a card that broke the rules), so a thin brief says why. */
  problems: string[];
}

export const BRIEF_NOTE = "候选卡只依据站内数据与公开报道：证据都带出处，缺的写在“缺口”里；没有合格候选就少给。这不是买卖建议，也不是价格预测。";
