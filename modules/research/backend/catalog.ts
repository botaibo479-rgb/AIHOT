// The instruments the module can quote (instruments.json), read once when the process starts. A broken
// entry stops the start: a typo in a symbol is better found then than as a gap in the data weeks later.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ENTITIES } from "@aihot/industry/taxonomy";
import { TOPICS } from "@aihot/backend/publication/topics";

const Quote = z.strictObject({ source: z.enum(["binance", "okx", "twelvedata", "fred", "deribit", "defillama", "cftc", "eia"]), symbol: z.string().min(1) });

const Instrument = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  market: z.enum(["crypto", "equities", "commodities", "fx", "macro"]),
  kind: z.enum(["crypto", "stock", "etf", "index", "rate", "fx", "commodity-spot", "positioning", "inventory", "supply"]),
  entityId: z.string().nullable(),
  role: z.enum(["candidate", "context"]),
  unit: z.string().optional(),
  /** Read in points rather than percent (a figure that can cross zero); a "%" unit is always read in points. */
  move: z.literal("points").optional(),
  quote: Quote.nullable(),
});

const Catalog = z.strictObject({
  $comment: z.string().optional(),
  nominate: z.strictObject({ windowHours: z.number().positive(), minSources: z.number().int().positive() }),
  signals: z.strictObject({
    oiChange7d: z.number().positive(), volumeRatio: z.number().positive(), fundingRate: z.number().positive(),
    attentionSources: z.number().int().positive(), quietSources: z.number().int().nonnegative(), flatMove24h: z.number().positive(),
  }),
  instruments: z.array(Instrument),
});

export type Instrument = z.infer<typeof Instrument>;
export type Catalog = z.infer<typeof Catalog>;

export function parseCatalog(json: unknown): Catalog {
  const catalog = Catalog.parse(json);
  const seen = new Set<string>();
  for (const i of catalog.instruments) {
    if (seen.has(i.id)) throw new Error(`instruments.json: ${i.id} is listed twice`);
    seen.add(i.id);
    if (i.entityId && !ENTITIES[i.entityId]) throw new Error(`instruments.json: ${i.id} names entity ${i.entityId}, which industry/taxonomy.ts does not list`);
    if (i.role === "candidate" && !i.entityId) throw new Error(`instruments.json: ${i.id} can be nominated only with an entity whose reports it counts`);
    if (i.quote && (i.quote.source === "binance" || i.quote.source === "okx") !== (i.kind === "crypto")) throw new Error(`instruments.json: ${i.id} has a ${i.quote.source} quote for a ${i.kind}`);
  }
  return catalog;
}

export const CATALOG = parseCatalog(JSON.parse(readFileSync(new URL("../instruments.json", import.meta.url), "utf8")));

export const byId = (id: string) => CATALOG.instruments.find((i) => i.id === id.toLowerCase()) ?? null;

/** The topic page of an instrument's entity, when the topics list one. */
export const topicOf = (entityId: string | null) => (entityId ? TOPICS.find((t) => t.entityId === entityId)?.slug ?? null : null);
