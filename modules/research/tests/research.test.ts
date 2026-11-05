// The research module against local stand-ins for the exchanges, FRED and Twelve Data. Failure cases:
// the day still trading is stored as a close; a FRED holiday (".") breaks the series; a rate's move is
// read in percent; one source failing stops the others; a missing key looks like a broken source; a
// nomination overrides the owner; the owner's write works without the token; the flags fire on nothing.
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { tag } from "../../../tests/setup.ts";

process.env.ALLOW_PRIVATE_NETWORK_FETCH = "true";
process.env.INGEST_TOKEN = "research-test-ingest-token-0123";
delete process.env.FRED_API_KEY;
delete process.env.TWELVEDATA_API_KEY;
delete process.env.EIA_API_KEY;

const { sql, closeDb } = await import("@aihot/backend/db");
const { installModules } = await import("@aihot/backend/modules");
const { stopBoss } = await import("@aihot/backend/jobs/queue");
const { loadTopicPage } = await import("@aihot/backend/publication/topics");
const { default: research } = await import("../server.ts");
const { ENDPOINTS } = await import("../backend/sources.ts");
const { collectDaily, collectSnapshots, pruneSnapshots } = await import("../backend/collect.ts");
const { instrumentDetail, listInstruments } = await import("../backend/read.ts");
const { decide, nominate } = await import("../backend/watch.ts");

installModules([research]);
const { buildApp } = await import("../../../apps/api/src/app.ts");

const NOW = new Date("2026-11-05T09:00:00Z");
const DAY = 86_400_000;
const T = tag();

/** A day's open, `back` days before NOW's UTC day. */
const dayOpen = (back: number) => Date.parse("2026-11-05T00:00:00Z") - back * DAY;

/** The stand-ins: every crypto pair trades at 100 for weeks, closes at 105 yesterday and is at 110 now. */
function answer(url: URL): { status: number; body: unknown } {
  const p = url.pathname;
  if (p === "/api/v3/ticker/24hr") return { status: 200, body: { lastPrice: "110", priceChangePercent: "0.5", quoteVolume: "3000" } };
  if (p === "/api/v3/klines") {
    // 36 finished days and today's, which is still trading.
    const rows = Array.from({ length: 37 }, (_, k) => {
      const back = 36 - k;
      const open = dayOpen(back);
      return [open, "100", "100", "100", back === 1 ? "105" : "100", "10", open + DAY - 1, "1000"];
    });
    return { status: 200, body: rows };
  }
  if (p === "/fapi/v1/premiumIndex") return { status: 200, body: { markPrice: "110.11", indexPrice: "110", lastFundingRate: "0.0001" } };
  if (p === "/fapi/v1/openInterest") return { status: 200, body: { openInterest: "1250" } };
  // Stamped at each day's close: yesterday's open interest is 1250, a week before 1000.
  if (p === "/futures/data/openInterestHist") return { status: 200, body: Array.from({ length: 30 }, (_, k) => ({ timestamp: dayOpen(29 - k), sumOpenInterest: k === 29 ? "1250" : "1000" })) };
  if (p === "/fred/series/observations") {
    const series = url.searchParams.get("series_id");
    const values: Array<[string, string]> = series === "DGS10"
      ? [["2026-11-04", "4.20"], ["2026-11-03", "."], ["2026-11-02", "4.10"], ["2026-10-30", "4.05"], ["2026-10-28", "4.00"], ["2026-10-27", "3.95"]]
      : [["2026-11-04", "200"], ["2026-11-03", "198"], ["2026-10-28", "190"]];
    return { status: 200, body: { observations: values.map(([date, value]) => ({ date, value })) } };
  }
  if (p === "/time_series") {
    if (url.searchParams.get("symbol") === "COIN") return { status: 200, body: { status: "error", code: 429, message: "API credits exhausted" } };
    return { status: 200, body: { status: "ok", values: [{ datetime: "2026-11-04", close: "50", volume: "300" }, { datetime: "2026-11-03", close: "49", volume: "100" }] } };
  }
  // DVOL: one candle a UTC day, today's still forming.
  if (p === "/api/v2/public/get_volatility_index_data") return { status: 200, body: { result: { data: Array.from({ length: 10 }, (_, k) => [dayOpen(9 - k), "50", "52", "48", k === 8 ? "55" : "50"]) } } };
  if (p === "/stablecoincharts/all") return { status: 200, body: [{ date: String(dayOpen(2) / 1000), totalCirculatingUSD: { peggedUSD: 300e9 } }, { date: String(dayOpen(1) / 1000), totalCirculatingUSD: { peggedUSD: 303e9 } }] };
  if (p === "/resource/6dca-aqww.json") {
    if (!url.searchParams.get("$where")?.includes("'133741'")) return { status: 200, body: [] };
    return { status: 200, body: [
      { report_date_as_yyyy_mm_dd: "2026-11-03T00:00:00.000", noncomm_positions_long_all: "1000", noncomm_positions_short_all: "1500", open_interest_all: "30000" },
      { report_date_as_yyyy_mm_dd: "2026-10-27T00:00:00.000", noncomm_positions_long_all: "1200", noncomm_positions_short_all: "1100", open_interest_all: "28000" },
    ] };
  }
  if (p === "/v2/petroleum/stoc/wstk/data/") return { status: 200, body: { response: { data: [{ period: "2026-10-30", value: 421000 }, { period: "2026-10-23", value: 425000 }] } } };
  return { status: 404, body: {} };
}

const server = http.createServer((req, res) => {
  const { status, body } = answer(new URL(req.url ?? "/", "http://stub"));
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
Object.assign(ENDPOINTS, { binanceSpot: base, binanceFutures: base, okx: base, fred: base, twelvedata: base, deribit: base, defillama: base, cftc: base, eia: base });

const app = await buildApp();
const SOURCES = [1, 2, 3].map((k) => `research-${T}-${k}`);

before(async () => {
  for (const id of SOURCES) await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${id}, ${id}, 'rss', 'T2')`;
});
after(async () => {
  await app.close();
  server.close();
  await stopBoss();
  await closeDb();
});

/** A public report about an entity from a source, `hours` before NOW. */
async function report(source: string, entity: string, hours: number) {
  const id = `${source}-${entity}-${hours}`;
  const at = new Date(NOW.getTime() - hours * 3_600_000);
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
    VALUES (${id}, ${source}, ${id}, ${`https://example.org/${id}`}, ${id}, ${at}, ${at})`;
  await sql`INSERT INTO publications (article_id, source_id, title, url, discovered_at, timeline_at, sort_at, visible_after, selected, eligible, visibility, channel, tags)
    VALUES (${id}, ${source}, ${id}, ${`https://example.org/${id}`}, ${at}, ${at}, ${at}, ${at}, false, true, 'public', 'news', ${[`entity:${entity}`]})`;
}

test("crypto snapshots keep finished days only and read the perpetual's numbers", async () => {
  const run = await collectSnapshots(NOW);
  assert.deepEqual(run.failed, {});
  assert.ok(run.ok.includes("btc"));
  const days = await sql<{ day: string }[]>`SELECT day::text AS day FROM research_daily WHERE instrument_id = 'btc' ORDER BY day`;
  assert.equal(days.length, 36);
  assert.equal(days.at(-1)!.day, "2026-11-04", "today's candle is still trading");

  const btc = (await instrumentDetail("BTCUSDT", NOW))!;
  assert.equal(btc.id, "btc");
  const q = btc.quote!;
  assert.equal(q.price, 110);
  assert.equal(q.daily, false);
  assert.equal(q.change1d, 0.005);
  assert.ok(Math.abs(q.change7d! - 0.1) < 1e-9, "against the close a week before");
  assert.equal(q.volumeRatio, 3);
  assert.ok(Math.abs(q.perp!.openInterestChange7d! - 0.25) < 1e-9);
  assert.ok(Math.abs(q.perp!.basis! - 0.001) < 1e-9);
  assert.equal(q.stale, false);
  assert.deepEqual(btc.flags.map((f) => f.key), ["capital", "capital_quiet"], "money moved while nobody reported it");
  assert.equal((await instrumentDetail("btc", new Date(NOW.getTime() + 2 * 3_600_000)))!.quote!.stale, true);
});

test("daily series: a missing key is skipped, a holiday is no value, one failure leaves the rest, rates move in points", async () => {
  const unkeyed = await collectDaily(NOW);
  assert.equal(unkeyed.skipped.dgs10, "FRED_API_KEY is not set");
  assert.equal(unkeyed.skipped.spy, "TWELVEDATA_API_KEY is not set");
  assert.equal(unkeyed.skipped["crude-stocks"], "EIA_API_KEY is not set");
  assert.ok(unkeyed.ok.includes("btc-dvol") && unkeyed.ok.includes("stablecoin-supply") && unkeyed.ok.includes("cot-btc"), "the free series need no key");

  process.env.FRED_API_KEY = "fred-test-key";
  process.env.TWELVEDATA_API_KEY = "twelvedata-test-key";
  process.env.EIA_API_KEY = "eia-test-key";
  try {
    const run = await collectDaily(NOW);
    assert.match(run.failed.coin!, /API credits exhausted/);
    assert.ok(run.ok.includes("dgs10") && run.ok.includes("spy") && run.ok.includes("btc"));
  } finally {
    delete process.env.FRED_API_KEY;
    delete process.env.TWELVEDATA_API_KEY;
    delete process.env.EIA_API_KEY;
  }
  const rate = (await instrumentDetail("dgs10", NOW))!;
  assert.deepEqual(rate.daily.map((d) => d.day), ["2026-10-27", "2026-10-28", "2026-10-30", "2026-11-02", "2026-11-04"]);
  assert.equal(rate.quote!.change1d, null, "a yield's move is not a percent of itself");
  assert.ok(Math.abs(rate.quote!.changePoints1d! - 0.1) < 1e-9);
  assert.ok(Math.abs(rate.quote!.changePoints7d! - 0.2) < 1e-9);
  const spy = (await instrumentDetail("spy", NOW))!;
  assert.equal(spy.quote!.label, "Twelve Data 日线收盘 SPY");
  assert.ok(Math.abs(spy.quote!.change1d! - (50 / 49 - 1)) < 1e-9);
  const dvol = (await instrumentDetail("btc-dvol", NOW))!;
  assert.equal(dvol.daily.at(-1)!.day, "2026-11-04", "today's volatility candle is still forming");
  assert.equal(dvol.quote!.price, 55);
  // A net position crosses zero: read in contracts, not percent.
  const cot = (await instrumentDetail("cot-btc", NOW))!;
  assert.deepEqual([cot.quote!.price, cot.quote!.points, cot.quote!.change1d, cot.quote!.changePoints1d], [-500, true, null, -600]);
  assert.equal(cot.quote!.stale, false, "a weekly series is not stale within its week");
  assert.equal((await instrumentDetail("crude-stocks", NOW))!.quote!.price, 421000);
  assert.ok(Math.abs((await instrumentDetail("stablecoin-supply", NOW))!.quote!.change1d! - 0.01) < 1e-9);
  const tencent = (await instrumentDetail("tencent", NOW))!;
  assert.equal(tencent.quote, null);
  assert.match(tencent.quoteNote!, /港股/);
});

test("enough independent sources nominate an instrument; the owner's decision stands", async () => {
  for (const [k, source] of SOURCES.entries()) await report(source, "solana", 5 + k);
  await report(SOURCES[0]!, "ethereum", 3);
  await report(SOURCES[1]!, "ethereum", 4);
  assert.deepEqual((await nominate(NOW)).nominated, ["sol"], "two sources on ethereum are not enough");
  const sol = (await instrumentDetail("sol", NOW))!;
  assert.equal(sol.watch?.state, "nominated");
  assert.match(sol.watch!.reason!, /3 个独立来源/);
  assert.deepEqual(sol.flags.map((f) => f.key), ["capital", "attention_rising", "spread_no_move"]);

  await decide("sol", "dropped", "不看", NOW);
  await report(SOURCES[2]!, "ethereum", 2);
  assert.deepEqual((await nominate(NOW)).nominated, ["eth"]);
  assert.equal((await instrumentDetail("sol", NOW))!.watch?.state, "dropped", "a nomination never undoes the owner");
});

test("the JSON, the owner's write and the Agent tool", async () => {
  const list = await app.inject({ method: "GET", url: "/api/research/instruments" });
  assert.equal(list.statusCode, 200);
  assert.ok((JSON.parse(list.body) as { instruments: unknown[] }).instruments.length > 20);
  assert.equal((await app.inject({ method: "GET", url: "/api/research/instruments/nothing-like-it" })).statusCode, 404);

  const write = (id: string, payload: unknown, token?: string) => app.inject({
    method: "POST", url: `/api/research/watch/${id}`, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  assert.equal((await write("btc", { state: "watching" })).statusCode, 401);
  assert.equal((await write("btc", { state: "maybe" }, process.env.INGEST_TOKEN)).statusCode, 400);
  assert.equal((await write("nothing", { state: "watching" }, process.env.INGEST_TOKEN)).statusCode, 404);
  assert.equal((await write("btc", { state: "watching", reason: "主线" }, process.env.INGEST_TOKEN)).statusCode, 200);
  assert.equal((await listInstruments()).instruments.find((v) => v.id === "btc")!.watch?.by, "owner");

  const tool = research.agent!.abilities![0]!.mcp;
  const overview = await tool.run({});
  assert.match(overview.text, /## 观察中\n- \*\*比特币 BTC\*\*/);
  const one = await tool.run({ symbol: "BTC" });
  assert.equal((one.structured.instrument as { id: string }).id, "btc");
  assert.match((await tool.run({ symbol: "nope" })).text, /没有叫「nope」的标的/);
  const markdown = await app.inject({ method: "GET", url: "/api/v1/agent/instruments" });
  assert.equal(markdown.statusCode, 200);
});

test("an instrument's topic page carries its quote; old snapshots go, daily closes stay", async () => {
  const page = (await loadTopicPage("bitcoin", 1, NOW))!;
  const views = page.modules.research as Array<{ id: string }>;
  assert.deepEqual(views.map((v) => v.id), ["btc", "btc-dvol", "cot-btc"], "the price, its volatility and its futures positioning");
  assert.equal(await loadTopicPage("fed", 1, NOW).then((p) => (p!.modules.research as Array<{ id: string }>).map((v) => v.id).join()), "fed-upper");

  await sql`INSERT INTO research_quotes (instrument_id, at, source, price) VALUES ('btc', ${new Date(NOW.getTime() - 40 * DAY)}, 'binance', 90)`;
  const days = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM research_daily`)[0]!.n;
  assert.ok((await pruneSnapshots(NOW)).researchQuotesDeleted >= 1);
  assert.equal((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM research_daily`)[0]!.n, days);
});
