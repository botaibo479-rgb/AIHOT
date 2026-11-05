// Candidate cards, the daily brief and the judgment archive against a local stand-in for the model.
// Failure cases: evidence citing nothing given, a figure not in the inputs, a price target or a probability
// reaches the card; narrative alone opens a judgment; a brief is rewritten; a revision rewrites an earlier
// one; a price across a condition is not noticed; an ended judgment has no review; the owner writes without
// the token or reopens what ended.
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { stub, tag } from "../../../tests/setup.ts";

process.env.INGEST_TOKEN = "research-brief-test-token-0123";
const T = tag();

/** The model writes a card from what it is shown, by instrument. */
const model = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
  const answer = (content: unknown) => ({ id: "stub", model: "stub", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  const input = JSON.parse(body.messages.at(-1)!.content) as { instrument: { id: string }; metrics: Record<string, string>; events: Array<{ ref: string; title: string }> };
  if (input.instrument.id === "sol") return answer("这不是 JSON");
  if (input.instrument.id === "eth") return answer({ level: "candidate", whyNow: "讨论在变多", evidence: { capital: [], narrative: [{ claim: "48 小时内报道增加", ref: "attention.sources48h" }], rules: [] }, gaps: [], triggers: [{ text: "讨论继续扩散" }], invalidations: [{ text: "讨论平息" }], risks: [], horizonDays: 7 });
  const oi = input.metrics["perp.openInterestChange7d"];
  return answer({
    level: "candidate",
    whyNow: `资金先动：未平仓量 7 日 ${oi}，讨论未扩散`,
    catalysts: [input.events[0]!.ref, "e:999999"],
    evidence: {
      capital: [{ claim: `未平仓量 7 日 ${oi}`, ref: "perp.openInterestChange7d" }, { claim: "成交额放大 77%", ref: "quote.volumeRatio" }],
      narrative: [{ claim: "多家媒体报道", ref: "a:not-given" }],
      rules: [{ claim: input.events[0]!.title, ref: input.events[0]!.ref }],
    },
    gaps: ["没有可靠的现货持仓数据"],
    triggers: [{ text: "价格站上 115", check: { metric: "price", op: ">=", value: 115 } }, { text: "价格站上 99999", check: { metric: "price", op: ">=", value: 99999 } }],
    invalidations: [{ text: "价格跌破 100", check: { metric: "price", op: "<=", value: 100 } }],
    risks: ["目标价 200", "未平仓量上升可能来自空头"],
    horizonDays: 10,
  });
});
process.env.LLM_BASE_URL = `${model.url}/v1`;
process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "stub-model";

const { sql, closeDb } = await import("@aihot/backend/db");
const { installModules } = await import("@aihot/backend/modules");
const { stopBoss } = await import("@aihot/backend/jobs/queue");
const { default: research } = await import("../server.ts");
installModules([research]);
const { addOwnerEvent } = await import("../backend/events.ts");
const { composeBrief } = await import("../backend/brief.ts");
const { checkTheses, getThesis, listTheses } = await import("../backend/theses.ts");
const { buildApp } = await import("../../../apps/api/src/app.ts");
const app = await buildApp();

const NOW = new Date("2026-11-05T01:00:00Z");
const DAY = 86_400_000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY);
const auth = { authorization: `Bearer ${process.env.INGEST_TOKEN}` };

after(async () => {
  await app.close();
  await model.close();
  await stopBoss();
  await closeDb();
});

// BTC is watched, trades at 110 after weeks at 100, with open interest up a quarter; ETH and SOL are nominated.
await sql`INSERT INTO research_quotes (instrument_id, at, source, price, change_24h, quote_volume_24h, funding_rate, open_interest, mark_price, index_price)
  VALUES ('btc', ${new Date(NOW.getTime() - 600_000)}, 'binance', 110, 0.005, 3000, 0.0001, 1250, 110.1, 110)`;
for (let k = 1; k <= 35; k++) {
  await sql`INSERT INTO research_daily (instrument_id, day, source, close, volume, open_interest)
    VALUES ('btc', ${new Date(NOW.getTime() - k * DAY).toISOString().slice(0, 10)}, 'binance', 100, 1000, ${k === 1 ? 1250 : 1000})`;
}
await sql`INSERT INTO research_watch VALUES ('btc', 'watching', '主线', 'owner', ${NOW}), ('eth', 'nominated', 'x', 'auto', ${NOW}), ('sol', 'nominated', 'x', 'auto', ${NOW})`;
const eventId = await addOwnerEvent({ title: `比特币期权大额到期 ${T}`, date: "2026-11-10", confirmation: "official", entities: ["bitcoin"] }, NOW);

test("the brief keeps only grounded cards, opens a judgment for a real candidate and is written once", async () => {
  const run = await composeBrief(NOW);
  assert.deepEqual([run.written, run.candidates, run.leads], [true, 1, 1]);
  const [row] = await sql<{ content: import("../contract.ts").Brief }[]>`SELECT content FROM research_briefs WHERE day = '2026-11-05'`;
  const brief = row!.content;
  const btc = brief.candidates[0]!;
  assert.equal(btc.instrument.id, "btc");
  const card = btc.card;
  assert.equal(card.whyNow, "资金先动：未平仓量 7 日 25.0%，讨论未扩散");
  assert.deepEqual(card.evidence.capital.map((e) => e.ref), ["perp.openInterestChange7d"], "a figure not in the inputs is dropped");
  assert.deepEqual(card.evidence.narrative, [], "evidence citing nothing given is dropped");
  assert.deepEqual(card.evidence.rules.map((e) => e.ref), [`e:${eventId}`]);
  assert.deepEqual(card.catalysts, [`e:${eventId}`]);
  assert.deepEqual(card.triggers.map((c) => [c.text, c.check?.value]), [["价格站上 115", 115]], "a level 10 times away from the price is dropped");
  assert.deepEqual(card.risks, ["未平仓量上升可能来自空头"], "no price targets");
  assert.equal(brief.leads[0]!.instrument.id, "eth", "narrative alone is a lead");
  assert.match(brief.problems.join("\n"), /Solana SOL：模型的回答不合格式/);
  assert.equal(brief.events.official.some((e) => e.id === eventId), true);

  const thesis = (await getThesis(btc.thesisId!))!;
  assert.deepEqual([thesis.status, thesis.revisions.length, thesis.revisions[0]!.price, thesis.until], ["watching", 1, 110, "2026-11-15"]);
  assert.equal((await listTheses({ instrument: "eth" })).length, 0);

  assert.deepEqual((await composeBrief(new Date(NOW.getTime() + 3_600_000))).written, false, "one brief a day, never rewritten");
  const res = await app.inject({ method: "GET", url: "/api/research/briefs/latest" });
  assert.equal((JSON.parse(res.body) as { brief: { day: string } }).brief.day, "2026-11-05");
});

test("the daily check: near, then triggered, appended with a review; the first card stays as written", async () => {
  const [thesis] = await listTheses({ instrument: "btc" });
  const first = JSON.stringify(thesis!.revisions[0]);
  await sql`INSERT INTO research_quotes (instrument_id, at, source, price) VALUES ('btc', ${later(1)}, 'binance', 113)`;
  assert.deepEqual((await checkTheses(later(1))).map((u) => [u.from, u.to]), [["watching", "near"]]);
  assert.deepEqual(await checkTheses(later(1)), [], "nothing new, nothing appended");
  await sql`INSERT INTO research_quotes (instrument_id, at, source, price) VALUES ('btc', ${later(2)}, 'binance', 116)`;
  assert.deepEqual((await checkTheses(later(2))).map((u) => [u.from, u.to]), [["near", "triggered"]]);
  const ended = (await getThesis(thesis!.id))!;
  assert.deepEqual(ended.revisions.map((r) => [r.rev, r.kind, r.status, r.author]), [
    [1, "open", "watching", "model"], [2, "status", "near", "rule"], [3, "status", "triggered", "rule"], [4, "review", "triggered", "rule"],
  ]);
  const review = ended.revisions[3]!.content as import("../contract.ts").Review;
  assert.ok(Math.abs(review.change! - (116 / 110 - 1)) < 1e-9);
  assert.equal(review.benchmark, null, "BTC is its own benchmark");
  assert.match(review.hit!, /价格站上 115/);
  assert.equal(JSON.stringify(ended.revisions[0]), first, "the opening revision is untouched");
});

test("the owner's judgments and notes need the token, append only, and an ended judgment takes notes only", async () => {
  const open = (payload: object, headers: Record<string, string> = auth) => app.inject({ method: "POST", url: "/api/research/theses", payload, headers });
  const spy = { instrument: "spy", whyNow: "等议息", triggers: [{ text: "站上 700", price: 700, op: ">=" }], invalidations: [{ text: "跌破 600", price: 600, op: "<=" }], horizonDays: 3 };
  assert.equal((await open(spy, {})).statusCode, 401);
  assert.equal((await open({ ...spy, triggers: [] })).statusCode, 400);
  assert.equal((await open({ ...spy, instrument: "nope" })).statusCode, 404);
  const created = await open(spy);
  assert.equal(created.statusCode, 200);
  const id = (JSON.parse(created.body) as { id: number }).id;

  const revise = (payload: object) => app.inject({ method: "POST", url: `/api/research/theses/${id}/revisions`, payload, headers: auth });
  assert.equal((await revise({ kind: "note", reason: "看 12 月议息" })).statusCode, 200);
  assert.equal((await revise({ kind: "status", reason: "缺状态" })).statusCode, 400);
  const expired = await checkTheses(later(5));
  assert.deepEqual(expired.filter((u) => u.thesisId === id).map((u) => u.to), ["expired"]);
  assert.equal((await revise({ kind: "status", status: "watching", reason: "重新打开" })).statusCode, 409);
  assert.equal((await revise({ kind: "note", reason: "复盘：议息前就该关注美元" })).statusCode, 200);
  const t = (await getThesis(id))!;
  assert.deepEqual(t.revisions.map((r) => [r.kind, r.status, r.author]), [
    ["open", "watching", "owner"], ["note", "watching", "owner"], ["status", "expired", "rule"], ["review", "expired", "rule"], ["note", "expired", "owner"],
  ]);

  const tool = (name: string) => research.agent!.abilities!.find((a) => a.mcp.tool === name)!.mcp;
  assert.match((await tool("get_brief").run({})).text, /## 优先关注（1）[\s\S]*比特币 BTC/);
  assert.match((await tool("get_thesis").run({ id })).text, /rev5 .* note .* 复盘：议息前就该关注美元/);
  assert.match((await tool("get_thesis").run({ id: 999999 })).text, /没有编号为 999999 的判断/);
  const list = await app.inject({ method: "GET", url: "/api/research/theses?status=ended" });
  assert.ok((JSON.parse(list.body) as { theses: Array<{ id: number }> }).theses.some((x) => x.id === id));
});
