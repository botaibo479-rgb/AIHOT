// The market data the module reads, one function per question to each source. Free public endpoints, or free
// tiers with a key (TWELVEDATA_API_KEY, FRED_API_KEY, EIA_API_KEY): nothing here is paid, so no receipt; the schedules keep
// far inside the free tiers (a few dozen calls a day for the daily series).
// None of these were reached from the machine this was written on: check them from the server first
// (docs/research-plan.md, step 2).
import { credential } from "@aihot/backend/config";
import { DEFAULT_UA, guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";

/** Where each source answers; tests point them at a local stub. */
export const ENDPOINTS = {
  binanceSpot: "https://api.binance.com",
  binanceFutures: "https://fapi.binance.com",
  okx: "https://www.okx.com",
  fred: "https://api.stlouisfed.org",
  twelvedata: "https://api.twelvedata.com",
  deribit: "https://www.deribit.com",
  defillama: "https://stablecoins.llama.fi",
  cftc: "https://publicreporting.cftc.gov",
  eia: "https://api.eia.gov",
};

export interface Snapshot {
  price: number;
  change24h: number | null;
  quoteVolume24h: number | null;
  perp: { fundingRate: number | null; openInterest: number | null; markPrice: number | null; indexPrice: number | null } | null;
}

export interface Day {
  /** YYYY-MM-DD: a crypto pair's UTC day, a stock's or a series' own date. */
  day: string;
  close: number;
  volume: number | null;
  openInterest: number | null;
}

async function getJson(url: string, what: string): Promise<unknown> {
  const res = requireOk(await guardedFetch(url, { headers: { "user-agent": DEFAULT_UA, accept: "application/json" }, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 }), what);
  return JSON.parse(res.text());
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const must = (v: unknown, what: string): number => {
  const n = num(v);
  if (n === null) throw new Error(`${what}: not a number`);
  return n;
};
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ── Binance: spot USDT pair and the USDⓈ-M perpetual of the same symbol ─────────────────────────────

async function binanceSnapshot(symbol: string): Promise<Snapshot> {
  const q = encodeURIComponent(symbol);
  const ticker = await getJson(`${ENDPOINTS.binanceSpot}/api/v3/ticker/24hr?symbol=${q}`, `Binance ticker ${symbol}`) as Record<string, unknown>;
  const [premium, interest] = await Promise.all([
    getJson(`${ENDPOINTS.binanceFutures}/fapi/v1/premiumIndex?symbol=${q}`, `Binance premium index ${symbol}`).catch(() => null) as Promise<Record<string, unknown> | null>,
    getJson(`${ENDPOINTS.binanceFutures}/fapi/v1/openInterest?symbol=${q}`, `Binance open interest ${symbol}`).catch(() => null) as Promise<Record<string, unknown> | null>,
  ]);
  const change = num(ticker.priceChangePercent);
  return {
    price: must(ticker.lastPrice, `Binance ${symbol} lastPrice`),
    change24h: change === null ? null : change / 100,
    quoteVolume24h: num(ticker.quoteVolume),
    perp: premium || interest ? {
      fundingRate: num(premium?.lastFundingRate), openInterest: num(interest?.openInterest),
      markPrice: num(premium?.markPrice), indexPrice: num(premium?.indexPrice),
    } : null,
  };
}

/** Completed UTC days only: the day still trading is left out. */
async function binanceDays(symbol: string, now: Date): Promise<Day[]> {
  const q = encodeURIComponent(symbol);
  const klines = await getJson(`${ENDPOINTS.binanceSpot}/api/v3/klines?symbol=${q}&interval=1d&limit=40`, `Binance klines ${symbol}`) as unknown[][];
  const history = await getJson(`${ENDPOINTS.binanceFutures}/futures/data/openInterestHist?symbol=${q}&period=1d&limit=30`, `Binance open interest history ${symbol}`).catch(() => []) as Array<Record<string, unknown>>;
  const interest = new Map(history.map((h) => [utcDay(must(h.timestamp, "openInterestHist timestamp")), num(h.sumOpenInterest)]));
  return klines
    .filter((k) => must(k[6], "kline close time") < now.getTime())
    .map((k) => {
      const day = utcDay(must(k[0], "kline open time"));
      // openInterestHist stamps each day at its close: the next day's 00:00.
      const next = utcDay(must(k[0], "kline open time") + 86_400_000);
      return { day, close: must(k[4], "kline close"), volume: num(k[7]), openInterest: interest.get(next) ?? interest.get(day) ?? null };
    });
}

// ── OKX: spot instId BTC-USDT and its perpetual BTC-USDT-SWAP ───────────────────────────────────────

const okxData = (body: unknown, what: string): unknown[] => {
  const b = body as { code?: string; msg?: string; data?: unknown[] };
  if (b.code !== "0" || !Array.isArray(b.data)) throw new Error(`${what}: ${b.msg || `code ${b.code}`}`);
  return b.data;
};

async function okxSnapshot(instId: string): Promise<Snapshot> {
  const swap = encodeURIComponent(`${instId}-SWAP`);
  const get = (path: string, what: string) => getJson(`${ENDPOINTS.okx}${path}`, what).then((b) => okxData(b, what)[0] as Record<string, unknown> | undefined);
  const ticker = await get(`/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`, `OKX ticker ${instId}`);
  if (!ticker) throw new Error(`OKX ticker ${instId}: empty`);
  const [funding, mark, index, interest] = await Promise.all([
    get(`/api/v5/public/funding-rate?instId=${swap}`, `OKX funding ${instId}`).catch(() => undefined),
    get(`/api/v5/public/mark-price?instType=SWAP&instId=${swap}`, `OKX mark ${instId}`).catch(() => undefined),
    get(`/api/v5/market/index-tickers?instId=${encodeURIComponent(instId)}`, `OKX index ${instId}`).catch(() => undefined),
    get(`/api/v5/public/open-interest?instType=SWAP&instId=${swap}`, `OKX open interest ${instId}`).catch(() => undefined),
  ]);
  const last = must(ticker.last, `OKX ${instId} last`);
  const open = num(ticker.open24h);
  return {
    price: last,
    change24h: open ? last / open - 1 : null,
    quoteVolume24h: num(ticker.volCcy24h),
    perp: funding || interest ? {
      fundingRate: num(funding?.fundingRate), openInterest: num(interest?.oiCcy),
      markPrice: num(mark?.markPx), indexPrice: num(index?.idxPx),
    } : null,
  };
}

async function okxDays(instId: string): Promise<Day[]> {
  const what = `OKX candles ${instId}`;
  const candles = okxData(await getJson(`${ENDPOINTS.okx}/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=1Dutc&limit=40`, what), what) as unknown[][];
  const historyWhat = `OKX open interest history ${instId}`;
  const history = await getJson(`${ENDPOINTS.okx}/api/v5/rubik/stat/contracts/open-interest-history?instId=${encodeURIComponent(`${instId}-SWAP`)}&period=1D&limit=30`, historyWhat)
    .then((b) => okxData(b, historyWhat) as unknown[][]).catch(() => []);
  // [ts, oi (contracts), oiCcy (coin), oiUsd]: the day it opened.
  const interest = new Map(history.map((h) => [utcDay(must(h[0], "OKX open interest ts")), num(h[2])]));
  return candles
    .filter((c) => c[8] === "1")
    .map((c) => {
      const day = utcDay(must(c[0], "OKX candle ts"));
      return { day, close: must(c[4], "OKX candle close"), volume: num(c[7]), openInterest: interest.get(day) ?? null };
    })
    .reverse();
}

// ── Daily series with a key ──────────────────────────────────────────────────────────────────────────

/** The key a source needs, or null when it has none: its instruments are skipped and say why. */
export const KEY_NAMES = { fred: "FRED_API_KEY", twelvedata: "TWELVEDATA_API_KEY", eia: "EIA_API_KEY" } as const;

export function sourceKey(source: keyof typeof KEY_NAMES): string | null {
  return credential("collectors", KEY_NAMES[source]);
}

async function fredDays(series: string, key: string): Promise<Day[]> {
  const body = await getJson(`${ENDPOINTS.fred}/fred/series/observations?series_id=${encodeURIComponent(series)}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=40`, `FRED ${series}`) as { observations?: Array<{ date: string; value: string }> };
  if (!Array.isArray(body.observations)) throw new Error(`FRED ${series}: no observations`);
  // "." marks a day without a value (a holiday).
  return body.observations.flatMap((o) => {
    const close = num(o.value);
    return close === null || !/^\d{4}-\d{2}-\d{2}$/.test(o.date) ? [] : [{ day: o.date, close, volume: null, openInterest: null }];
  }).reverse();
}

async function twelvedataDays(symbol: string, key: string): Promise<Day[]> {
  const body = await getJson(`${ENDPOINTS.twelvedata}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=40&apikey=${encodeURIComponent(key)}`, `Twelve Data ${symbol}`) as { status?: string; message?: string; values?: Array<Record<string, string>> };
  if (body.status !== "ok" || !Array.isArray(body.values)) throw new Error(`Twelve Data ${symbol}: ${body.message ?? body.status ?? "no values"}`);
  return body.values.map((v) => ({ day: String(v.datetime).slice(0, 10), close: must(v.close, `Twelve Data ${symbol} close`), volume: num(v.volume), openInterest: null })).reverse();
}

// ── Free series without a key ────────────────────────────────────────────────────────────────────────

/** Deribit's volatility index (DVOL) for BTC or ETH: one close per UTC day, the day still trading left out. */
async function deribitDays(currency: string, _key: null, now: Date): Promise<Day[]> {
  const end = now.getTime();
  const body = await getJson(`${ENDPOINTS.deribit}/api/v2/public/get_volatility_index_data?currency=${encodeURIComponent(currency)}&start_timestamp=${end - 45 * 86_400_000}&end_timestamp=${end}&resolution=1D`, `Deribit DVOL ${currency}`) as { result?: { data?: unknown[][] } };
  const rows = body.result?.data;
  if (!Array.isArray(rows)) throw new Error(`Deribit DVOL ${currency}: no data`);
  return rows
    .filter((r) => must(r[0], "DVOL ts") + 86_400_000 <= end)
    .map((r) => ({ day: utcDay(must(r[0], "DVOL ts")), close: must(r[4], "DVOL close"), volume: null, openInterest: null }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-40);
}

/** Every stablecoin's circulating supply in USD, summed by DefiLlama, one value a day. */
async function defillamaDays(_symbol: string, _key: null, _now: Date): Promise<Day[]> {
  const rows = await getJson(`${ENDPOINTS.defillama}/stablecoincharts/all`, "DefiLlama stablecoins") as Array<{ date: string | number; totalCirculatingUSD?: { peggedUSD?: number } }>;
  if (!Array.isArray(rows)) throw new Error("DefiLlama stablecoins: not a list");
  return rows.slice(-40).flatMap((r) => {
    const usd = num(r.totalCirculatingUSD?.peggedUSD);
    return usd === null ? [] : [{ day: utcDay(must(r.date, "DefiLlama date") * 1000), close: usd, volume: null, openInterest: null }];
  });
}

/**
 * The CFTC's legacy Commitments of Traders (futures only) for one contract market code: the non-commercial
 * net position (long − short) and the open interest, dated by the Tuesday it describes.
 */
async function cftcDays(code: string, _key: null, _now: Date): Promise<Day[]> {
  const where = encodeURIComponent(`cftc_contract_market_code='${code.replace(/[^0-9A-Z]/gi, "")}'`);
  const rows = await getJson(`${ENDPOINTS.cftc}/resource/6dca-aqww.json?$where=${where}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=20`, `CFTC COT ${code}`) as Array<Record<string, string>>;
  if (!Array.isArray(rows)) throw new Error(`CFTC COT ${code}: not a list`);
  return rows.map((r) => ({
    day: String(r.report_date_as_yyyy_mm_dd).slice(0, 10),
    close: must(r.noncomm_positions_long_all, "COT long") - must(r.noncomm_positions_short_all, "COT short"),
    volume: null,
    openInterest: num(r.open_interest_all),
  })).reverse();
}

/** An EIA weekly petroleum series (API v2), such as WCESTUS1: US commercial crude stocks in thousand barrels. */
async function eiaDays(series: string, key: string): Promise<Day[]> {
  const body = await getJson(`${ENDPOINTS.eia}/v2/petroleum/stoc/wstk/data/?api_key=${encodeURIComponent(key)}&frequency=weekly&data[0]=value&facets[series][]=${encodeURIComponent(series)}&sort[0][column]=period&sort[0][direction]=desc&length=30`, `EIA ${series}`) as { response?: { data?: Array<{ period: string; value: number | string }> } };
  const rows = body.response?.data;
  if (!Array.isArray(rows)) throw new Error(`EIA ${series}: no data`);
  return rows.flatMap((r) => {
    const value = num(r.value);
    return value === null || !/^\d{4}-\d{2}-\d{2}$/.test(r.period) ? [] : [{ day: r.period, close: value, volume: null, openInterest: null }];
  }).reverse();
}

export const crypto = {
  binance: { snapshot: binanceSnapshot, days: binanceDays },
  okx: { snapshot: okxSnapshot, days: (instId: string, _now: Date) => okxDays(instId) },
};

/** Daily (or weekly) series by source: those in KEY_NAMES get their key, the rest null. */
export const daily = { fred: fredDays, twelvedata: twelvedataDays, eia: eiaDays, deribit: deribitDays, defillama: defillamaDays, cftc: cftcDays };
