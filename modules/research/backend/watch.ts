// The watchlist is not written down in advance: an instrument enters it when enough independent sources
// report on it (instruments.json nominate), and the owner then keeps watching it or drops it. A nomination
// never overrides the owner: a watched or dropped instrument stays as the owner left it.
import { sql } from "@aihot/backend/db";
import type { WatchState } from "../contract.ts";
import { CATALOG, byId } from "./catalog.ts";
import { attentionByEntity } from "./read.ts";

/** Nominates the candidates reported by enough sources in the window that are not on the list yet. */
export async function nominate(now = new Date()): Promise<{ nominated: string[] }> {
  const { windowHours, minSources } = CATALOG.nominate;
  const attention = await attentionByEntity(now, windowHours);
  const listed = new Set((await sql<{ instrument_id: string }[]>`SELECT instrument_id FROM research_watch`).map((r) => r.instrument_id));
  const nominated: string[] = [];
  for (const i of CATALOG.instruments) {
    if (i.role !== "candidate" || !i.entityId || listed.has(i.id)) continue;
    const seen = attention.get(i.entityId);
    if (!seen || seen.sources < minSources) continue;
    const reason = `${windowHours} 小时内 ${seen.sources} 个独立来源、${seen.reports} 篇公开报道`;
    const rows = await sql`INSERT INTO research_watch (instrument_id, state, reason, changed_by, changed_at)
      VALUES (${i.id}, 'nominated', ${reason}, 'auto', ${now}) ON CONFLICT (instrument_id) DO NOTHING`;
    if (rows.count) nominated.push(i.id);
  }
  return { nominated };
}

export class WatchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The owner's decision about an instrument: watch it or drop it (with an optional reason). */
export async function decide(id: string, state: WatchState, reason: string | null, now = new Date()): Promise<void> {
  const instrument = byId(id);
  if (!instrument) throw new WatchError(404, "unknown instrument");
  if (state !== "watching" && state !== "dropped") throw new WatchError(400, "state must be watching or dropped");
  await sql`INSERT INTO research_watch (instrument_id, state, reason, changed_by, changed_at)
    VALUES (${instrument.id}, ${state}, ${reason}, 'owner', ${now})
    ON CONFLICT (instrument_id) DO UPDATE SET state = EXCLUDED.state, reason = EXCLUDED.reason, changed_by = 'owner', changed_at = EXCLUDED.changed_at`;
}
