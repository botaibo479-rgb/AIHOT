// The event calendar against a local stand-in for the model. Failure cases: a made-up quote, a past date or
// an unknown entity gets on the calendar; an "official" event without a date; the same event from a second
// report becomes a second event or weakens the first; a report is read twice; an unusable answer is asked
// again forever; the owner's write works without the token; speculation is listed as a schedule.
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { stub, tag } from "../../../tests/setup.ts";

process.env.INGEST_TOKEN = "research-events-test-token-0123";
const T = tag();

/** The model: what it says about a report depends on the marker in the report's title. */
const model = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
  const user = body.messages.at(-1)!.content;
  const answer = (content: unknown) => ({ id: "stub", model: "stub", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  if (user.includes("UNUSABLE")) return answer("这不是 JSON");
  if (user.includes("SECOND")) return answer({ events: [{ title: "Solana 第二批代币解锁", entities: ["solana"], date: "2026-11-20", precision: "day", confirmation: "tentative", quote: "The second unlock is expected on November 20." }] });
  return answer({ events: [
    { title: "Solana 代币解锁", entities: ["solana", "not-an-entity"], date: "2026-11-20", precision: "day", confirmation: "official", quote: "The unlock will occur on November 20, 2026." },
    { title: "编造的事件", entities: ["solana"], date: "2026-11-25", precision: "day", confirmation: "official", quote: "This sentence is nowhere in the report." },
    { title: "已经过去的事件", entities: ["solana"], date: "2026-10-01", precision: "day", confirmation: "official", quote: "Last month the network upgraded." },
    { title: "可能的 ETF 审批", entities: ["solana"], date: null, precision: "unknown", confirmation: "official", quote: "Analysts think an ETF could be approved." },
  ] });
});
process.env.LLM_BASE_URL = `${model.url}/v1`;
process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "stub-model";

const { sql, closeDb } = await import("@aihot/backend/db");
const { installModules } = await import("@aihot/backend/modules");
const { stopBoss } = await import("@aihot/backend/jobs/queue");
const { default: research } = await import("../server.ts");
installModules([research]);
const { acceptEvents, listEvents, scanReports, syncCalendar } = await import("../backend/events.ts");
const { instrumentDetail } = await import("../backend/read.ts");
const { buildApp } = await import("../../../apps/api/src/app.ts");
const app = await buildApp();

const NOW = new Date("2026-11-05T09:00:00Z");
const SOURCE = `events-${T}`;
await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${SOURCE}, ${SOURCE}, 'rss', 'T1')`;

after(async () => {
  await app.close();
  await model.close();
  await stopBoss();
  await closeDb();
});

/** A selected public report with its text. */
async function report(name: string, body: string, hoursAgo = 2) {
  const id = `${SOURCE}-${name}`;
  const at = new Date(NOW.getTime() - hoursAgo * 3_600_000);
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, body_text, body_status)
    VALUES (${id}, ${SOURCE}, ${id}, ${`https://example.org/${id}`}, ${name}, ${at}, ${at}, ${body}, 'ok')`;
  await sql`INSERT INTO publications (article_id, source_id, title, url, discovered_at, timeline_at, sort_at, visible_after, selected, eligible, visibility, channel, score)
    VALUES (${id}, ${SOURCE}, ${name}, ${`https://example.org/${id}`}, ${at}, ${at}, ${at}, ${at}, true, true, 'public', 'news', 80)`;
  return id;
}

test("only what the report says, about what is still ahead, gets on the calendar", () => {
  const text = "The unlock will occur on November 20, 2026. Mainnet ships in December.";
  const kept = acceptEvents([
    { title: "解锁", entities: ["solana", "nope"], date: "2026-11-20", precision: "day", confirmation: "official", quote: "The unlock  will occur on November 20, 2026." },
    { title: "主网", entities: ["solana"], date: "2026-12-17", precision: "month", confirmation: "tentative", quote: "Mainnet ships in December." },
    { title: "上个月", entities: ["solana"], date: "2026-10-31", precision: "month", confirmation: "official", quote: "Mainnet ships in December." },
    { title: "不存在的日子", entities: [], date: "2026-02-30", precision: "day", confirmation: "official", quote: "Mainnet ships in December." },
    { title: "编的", entities: [], date: "2026-12-01", precision: "day", confirmation: "official", quote: "Nothing like this was written." },
  ], text, "2026-11-05");
  assert.deepEqual(kept.map((e) => [e.title, e.entities.join(), e.startsOn, e.precision, e.confirmation]), [
    ["解锁", "solana", "2026-11-20", "day", "official"],
    ["主网", "solana", "2026-12-01", "month", "tentative"],
    ["不存在的日子", "", null, "unknown", "tentative"],
  ]);
});

test("the official calendar: dated, firm or tentative as the institution says, synced without churn", async () => {
  await syncCalendar(NOW);
  const updated = await sql`SELECT max(updated_at) AS at FROM research_events WHERE origin = 'calendar'`;
  await syncCalendar(new Date(NOW.getTime() + 60_000));
  assert.deepEqual(await sql`SELECT max(updated_at) AS at FROM research_events WHERE origin = 'calendar'`, updated, "nothing changed, nothing rewritten");
  const soon = await listEvents({ now: NOW, days: 45 });
  assert.deepEqual(soon.official.map((e) => e.startsOn), ["2026-12-04", "2026-12-09", "2026-12-10", "2026-12-15"]);
  assert.deepEqual(soon.tentative, []);
  const later = await listEvents({ now: NOW, days: 90 });
  assert.ok(later.tentative.some((e) => e.title.includes("FOMC") && e.startsOn === "2027-01-27"), "next year's meetings stay tentative");
});

test("reports are read once; the same event from another report is one event; nothing is made up", async () => {
  const first = await report(`FIRST`, "Solana news. The unlock will occur on November 20, 2026. Analysts think an ETF could be approved.");
  const run = await scanReports(NOW);
  assert.deepEqual(run, { read: 1, events: 2 });
  await report(`SECOND`, "Media recap. The second unlock is expected on November 20.");
  await report(`UNUSABLE`, "Some text.");
  assert.deepEqual(await scanReports(NOW), { read: 1, events: 1 });
  assert.deepEqual(await scanReports(NOW), { read: 0, events: 0 }, "every revision is read once, an unusable answer included");
  assert.equal((await sql`SELECT status FROM research_article_scans WHERE article_id = ${`${SOURCE}-UNUSABLE`}`)[0]!.status, "invalid");

  const list = await listEvents({ now: NOW });
  const unlock = list.official.find((e) => e.entities.includes("solana"))!;
  assert.equal(unlock.title, "Solana 代币解锁");
  assert.equal(unlock.articles.length, 2, "the second report joins the event");
  assert.equal(unlock.confirmation, "official", "a weaker report does not weaken it");
  assert.equal(unlock.quote, "The unlock will occur on November 20, 2026.");
  assert.deepEqual(unlock.instruments, ["sol"]);
  assert.deepEqual(list.speculative, []);
  assert.deepEqual(list.tentative.map((e) => [e.title, e.startsOn]), [["可能的 ETF 审批", null]], "an undated 'official' is only a plan");
  assert.ok(!JSON.stringify(list).includes("编造的事件") && !JSON.stringify(list).includes("已经过去的事件"));
  assert.ok((await instrumentDetail("sol", NOW))!.upcoming.some((e) => e.id === unlock.id));
  assert.ok(first);
});

test("the owner's events need the token, a date when official, and leave a trace when withdrawn", async () => {
  const post = (url: string, payload: object, token = true) => app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${process.env.INGEST_TOKEN}` } : {} });
  assert.equal((await post("/api/research/events", { title: "x", confirmation: "official" }, false)).statusCode, 401);
  assert.equal((await post("/api/research/events", { title: "没有日期的正式事件", confirmation: "official" })).statusCode, 400);
  assert.equal((await post("/api/research/events", { title: "x", confirmation: "official", date: "2026-12-01", entities: ["nope"] })).statusCode, 400);
  const added = await post("/api/research/events", { title: "某交易所上线 SOL 新合约", confirmation: "official", date: "2026-11-12", entities: ["solana"], url: "https://example.org/notice" });
  assert.equal(added.statusCode, 200);
  const id = (JSON.parse(added.body) as { id: number }).id;
  const listed = await app.inject({ method: "GET", url: "/api/research/events?instrument=sol" });
  assert.ok((JSON.parse(listed.body) as { official: Array<{ id: number }> }).official.some((e) => e.id === id));
  assert.equal((await app.inject({ method: "GET", url: "/api/research/events?days=0" })).statusCode, 400);

  assert.equal((await post(`/api/research/events/${id}/withdraw`, {})).statusCode, 400, "a withdrawal says why");
  assert.equal((await post(`/api/research/events/${id}/withdraw`, { reason: "公告已撤回" })).statusCode, 200);
  assert.equal((await post(`/api/research/events/${id}/withdraw`, { reason: "再撤一次" })).statusCode, 404);
  const [kept] = await sql`SELECT withdrawn_reason FROM research_events WHERE id = ${id}`;
  assert.equal(kept!.withdrawn_reason, "公告已撤回");

  const tool = research.agent!.abilities!.find((a) => a.mcp.tool === "list_events")!.mcp;
  const answer = await tool.run({});
  assert.match(answer.text, /## 正式日程[\s\S]*## 暂定安排[\s\S]*## 研究推测（不是日程）/);
  assert.match((await tool.run({ instrument: "nope" })).text, /没有叫「nope」/);
});
