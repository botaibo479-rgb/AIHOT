// Reading the instruments' prices (schedules in server.ts): crypto snapshots every 15 minutes, every daily
// series once a day. One instrument failing does not stop the others; what failed is the run's result
// (job_runs), and a source that stays silent shows as stale data (alerts in server.ts).
import { sql } from "@aihot/backend/db";
import { CATALOG, type Instrument } from "./catalog.ts";
import { crypto, daily, sourceKey, type Day } from "./sources.ts";

export interface RunResult {
  ok: string[];
  failed: Record<string, string>;
  skipped: Record<string, string>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

async function saveDays(instrumentId: string, source: string, days: Day[]): Promise<void> {
  for (const d of days) {
    await sql`INSERT INTO research_daily (instrument_id, day, source, close, volume, open_interest)
      VALUES (${instrumentId}, ${d.day}, ${source}, ${d.close}, ${d.volume}, ${d.openInterest})
      ON CONFLICT (instrument_id, day) DO UPDATE SET source = EXCLUDED.source, close = EXCLUDED.close, volume = EXCLUDED.volume,
        open_interest = COALESCE(EXCLUDED.open_interest, research_daily.open_interest)`;
  }
}

const cryptoInstruments = () => CATALOG.instruments.filter((i): i is Instrument & { quote: { source: "binance" | "okx" } } => i.quote?.source === "binance" || i.quote?.source === "okx");

/** One snapshot of every crypto instrument; an instrument without daily closes yet gets them too. */
export async function collectSnapshots(now = new Date()): Promise<RunResult> {
  const result: RunResult = { ok: [], failed: {}, skipped: {} };
  const known = new Set((await sql<{ instrument_id: string }[]>`SELECT DISTINCT instrument_id FROM research_daily`).map((r) => r.instrument_id));
  for (const i of cryptoInstruments()) {
    const venue = crypto[i.quote.source];
    try {
      const s = await venue.snapshot(i.quote.symbol);
      await sql`INSERT INTO research_quotes (instrument_id, at, source, price, change_24h, quote_volume_24h, funding_rate, open_interest, mark_price, index_price)
        VALUES (${i.id}, ${now}, ${i.quote.source}, ${s.price}, ${s.change24h}, ${s.quoteVolume24h}, ${s.perp?.fundingRate ?? null},
          ${s.perp?.openInterest ?? null}, ${s.perp?.markPrice ?? null}, ${s.perp?.indexPrice ?? null})
        ON CONFLICT DO NOTHING`;
      if (!known.has(i.id)) await saveDays(i.id, i.quote.source, await venue.days(i.quote.symbol, now));
      result.ok.push(i.id);
    } catch (error) {
      result.failed[i.id] = message(error);
    }
  }
  return result;
}

/** The daily closes of every instrument with a source: crypto days, stocks and ETFs, FRED series. */
export async function collectDaily(now = new Date()): Promise<RunResult> {
  const result: RunResult = { ok: [], failed: {}, skipped: {} };
  for (const i of CATALOG.instruments) {
    if (!i.quote) continue;
    try {
      let days: Day[];
      if (i.quote.source === "binance" || i.quote.source === "okx") days = await crypto[i.quote.source].days(i.quote.symbol, now);
      else {
        const key = sourceKey(i.quote.source);
        if (!key) {
          result.skipped[i.id] = `${i.quote.source === "fred" ? "FRED_API_KEY" : "TWELVEDATA_API_KEY"} is not set`;
          continue;
        }
        days = await daily[i.quote.source](i.quote.symbol, key);
      }
      await saveDays(i.id, i.quote.source, days);
      result.ok.push(i.id);
    } catch (error) {
      result.failed[i.id] = message(error);
    }
  }
  return result;
}

/** Snapshots older than 30 days go; the daily closes stay. */
export async function pruneSnapshots(now = new Date()): Promise<{ researchQuotesDeleted: number }> {
  const rows = await sql`DELETE FROM research_quotes WHERE at < ${new Date(now.getTime() - 30 * 86_400_000)}`;
  return { researchQuotesDeleted: rows.count };
}
