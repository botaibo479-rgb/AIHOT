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
