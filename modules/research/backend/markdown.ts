// The Agent answers (MCP hubble_get_instrument, /api/v1/agent/instruments): the same numbers as the JSON, as
// Markdown, ending with how to tell them to the person asking.
import { SITE } from "@aihot/site";
import { CONFIRMATION_LABELS, MARKET_LABELS, WATCH_LABELS, formatEventDate, formatMove, formatNumber, formatPercent, STATUS_LABELS, type Brief, type BriefEntry, type Card, type EventList, type EventView, type InstrumentDetail, type InstrumentList, type InstrumentView, type Review, type ThesisView } from "../contract.ts";

function quoteLine(v: InstrumentView): string {
  const q = v.quote;
  if (!q) return v.quoteNote ?? "没有行情";
  const parts = [`${formatNumber(q.price)}${q.unit && q.unit !== "%" ? ` ${q.unit}` : q.unit === "%" ? "%" : ""}`, `${q.daily ? "1 日" : "24 小时"} ${formatMove(q, "1d")}`, `7 日 ${formatMove(q, "7d")}`];
  if (q.perp?.fundingRate != null) parts.push(`资金费率 ${(q.perp.fundingRate * 100).toFixed(4)}%/8h`);
  if (q.perp?.openInterestChange7d != null) parts.push(`未平仓量 7 日 ${formatPercent(q.perp.openInterestChange7d, 1)}`);
  return `${parts.join("，")}（${q.label}，${q.at.slice(0, 16).replace("T", " ")} UTC${q.stale ? "，数据已过期" : ""}）`;
}

const flagText = (v: InstrumentView) => (v.flags.length ? v.flags.map((f) => `${f.label}（${f.detail}）`).join("；") : "无");

export function listAnswer(list: InstrumentList): string {
  const watched = list.instruments.filter((v) => v.watch?.state === "watching");
  const nominated = list.instruments.filter((v) => v.watch?.state === "nominated");
  const context = list.instruments.filter((v) => v.role === "context");
  const row = (v: InstrumentView) => `- **${v.name}**（\`${v.id}\`，${MARKET_LABELS[v.market]}）：${quoteLine(v)}。标记：${flagText(v)}`;
  return [
    `# ${SITE.name} 观察清单与行情`,
    "",
    `生成于 ${list.generatedAt.slice(0, 16).replace("T", " ")} UTC。${list.flagNote}`,
    "",
    "## 观察中",
    ...(watched.length ? watched.map(row) : ["（暂无：观察清单按报道聚合程度提名，再由站长确认。）"]),
    "",
    "## 已提名，等站长确认",
    ...(nominated.length ? nominated.map((v) => `${row(v)}。提名原因：${v.watch?.reason ?? "—"}`) : ["（暂无）"]),
    "",
    "## 市场背景",
    ...context.map(row),
    "",
    "## 回答提示",
    "- 价格和变化都带着数据来源和时间，转述时一起说；写着“数据已过期”的不要当成现价。",
    "- 标记只是按固定阈值筛出的提示，不要说成买卖信号或上涨预测；资金变化不等于买入或卖出。",
    `- 要看某个标的的细节，用同一个工具带上 symbol（比如 \`btc\`、\`IBIT\`）。`,
  ].join("\n");
}

export function detailAnswer(d: InstrumentDetail): string {
  const last = d.daily.slice(-7).map((p) => `${p.day}：${formatNumber(p.close)}${p.openInterest !== null ? `，未平仓量 ${formatNumber(p.openInterest)}` : ""}`);
  return [
    `# ${d.name}（\`${d.id}\`）`,
    "",
    `${MARKET_LABELS[d.market]} · ${d.watch ? WATCH_LABELS[d.watch.state] : "不在观察清单上"}${d.watch?.reason ? `（${d.watch.reason}）` : ""}`,
    "",
    `- 行情：${quoteLine(d)}`,
    ...(d.quote?.perp ? [`- 合约：${d.quote.perp.label}；基差 ${formatPercent(d.quote.perp.basis, 3)}；未平仓量 ${d.quote.perp.openInterest === null ? "—" : formatNumber(d.quote.perp.openInterest)}`] : []),
    ...(d.quote ? [`- 30 日日波动率 ${d.quote.volatility30d === null ? "—" : formatPercent(d.quote.volatility30d)}；成交额相对 20 日均值 ${d.quote.volumeRatio === null ? "—" : `${d.quote.volumeRatio.toFixed(2)} 倍`}`] : []),
    ...(d.attention ? [`- 报道：48 小时内 ${d.attention.sources48h} 个来源、${d.attention.reports48h} 篇；此前 48 小时 ${d.attention.sourcesPrev48h} 个来源`] : []),
    `- 标记：${flagText(d)}`,
    ...(d.upcoming.length ? [`- 未来 21 天：${d.upcoming.map((e) => `${formatEventDate(e)} ${e.title}（${CONFIRMATION_LABELS[e.confirmation]}）`).join("；")}`] : []),
    ...(d.topic ? [`- 相关报道：/topics/${d.topic}`] : []),
    "",
    ...(last.length ? ["## 最近 7 个日值", ...last.map((l) => `- ${l}`), ""] : []),
    "## 回答提示",
    `- ${d.flagNote}`,
    "- 日值按数据源自己的日期：加密按 UTC 日，美股和 FRED 按美国交易日。",
  ].join("\n");
}

function eventLine(e: EventView): string {
  const where = e.instruments.length ? `；相关标的 ${e.instruments.join("、")}` : "";
  const from = e.url ? `；出处 ${e.url}` : "";
  const quote = e.quote ? `；原文：“${e.quote}”` : "";
  return `- ${formatEventDate(e)}：**${e.title}**（\`${e.id}\`${where}${e.articles.length > 1 ? `；${e.articles.length} 篇报道` : ""}${from}${quote}）`;
}

export function eventsAnswer(list: EventList): string {
  const section = (title: string, events: EventView[]) => [`## ${title}`, ...(events.length ? events.map(eventLine) : ["（暂无）"]), ""];
  return [
    `# ${SITE.name} 事件日历：${list.from} 至 ${list.to}`,
    "",
    list.note,
    "",
    ...section("正式日程", list.official),
    ...section("暂定安排", list.tentative),
    ...section("研究推测（不是日程）", list.speculative),
    "## 回答提示",
    "- 三类分开说：正式日程是机构公布的，暂定安排可能改期，研究推测只是有人这样猜。",
    "- 不要补概率、市场共识或“已经定价多少”；这里没有这些数据。",
    "- 带原文的事件是从公开报道里读出来的，转述时附上出处。",
  ].join("\n");
}

function cardLines(card: Card): string[] {
  const ev = (label: string, list: Card["evidence"]["capital"]) => `- ${label}：${list.length ? list.map((e) => `${e.claim}（${e.ref}）`).join("；") : "无"}`;
  const cond = (list: Card["triggers"]) => (list.length ? list.map((c) => c.text).join("；") : "—");
  return [
    `- 为什么现在：${card.whyNow}`,
    ev("资本权", card.evidence.capital), ev("叙事权", card.evidence.narrative), ev("规则权", card.evidence.rules),
    `- 缺口：${card.gaps.length ? card.gaps.join("；") : "—"}`,
    `- 触发：${cond(card.triggers)}`,
    `- 失效：${cond(card.invalidations)}`,
    `- 风险：${card.risks.length ? card.risks.join("；") : "—"}`,
    `- 观察期：${card.horizonDays} 天`,
  ];
}

function entryLines(e: BriefEntry): string[] {
  const q = e.instrument.quote;
  return [
    `### ${e.instrument.name}（\`${e.instrument.id}\`${e.thesisId ? `，判断 #${e.thesisId}` : ""}）`,
    `- 行情：${quoteLine(e.instrument)}`,
    ...(e.instrument.upcoming.length ? [`- 未来事件：${e.instrument.upcoming.slice(0, 3).map((u) => `${formatEventDate(u)} ${u.title}（${CONFIRMATION_LABELS[u.confirmation]}）`).join("；")}`] : []),
    ...cardLines(e.card),
    ...(q?.stale ? ["- 注意：行情已过期"] : []),
    "",
  ];
}

export function briefAnswer(b: Brief): string {
  return [
    `# ${SITE.name} 研究简报 · ${b.day}`,
    "",
    b.note,
    "",
    `## 优先关注（${b.candidates.length}）`,
    ...(b.candidates.length ? b.candidates.flatMap(entryLines) : ["今天没有合格候选。", ""]),
    `## 线索（${b.leads.length}，证据不足，只记录）`,
    ...(b.leads.length ? b.leads.flatMap(entryLines) : ["（暂无）", ""]),
    "## 已有判断更新",
    ...(b.updates.length ? b.updates.map((u) => `- #${u.thesisId} ${u.instrumentName}：${STATUS_LABELS[u.from]} → ${STATUS_LABELS[u.to]}（${u.reason}）`) : ["（今天没有变化）"]),
    ...(b.open.length ? ["", "仍在观察：", ...b.open.map((o) => `- #${o.thesisId} ${o.instrumentName}：${STATUS_LABELS[o.status]}，观察到 ${o.until}`)] : []),
    "",
    "## 未来 3 周事件",
    ...[["正式日程", b.events.official], ["暂定安排", b.events.tentative], ["研究推测（不是日程）", b.events.speculative]].flatMap(([label, list]) => {
      const events = list as EventView[];
      return events.length ? [`${label}：`, ...events.map((e) => `- ${formatEventDate(e)} ${e.title}${e.instruments.length ? `（${e.instruments.join("、")}）` : ""}`)] : [];
    }),
    "",
    "## 市场背景",
    ...b.context.filter((v) => v.quote).map((v) => `- ${v.name}：${quoteLine(v)}`),
    ...(b.problems.length ? ["", "## 生成时的问题", ...b.problems.map((p) => `- ${p}`)] : []),
    "",
    "## 回答提示",
    "- 候选卡是研究准备，不是买卖建议；转述时带上触发、失效条件和缺口，不要只说结论。",
    "- 证据后面括号里是出处编号：a: 是报道，e: 是事件，其余是行情指标。",
  ].join("\n");
}

function reviewLine(r: Review): string {
  const change = r.change === null ? "—" : formatPercent(r.change);
  const bench = r.benchmark && r.benchmarkChange !== null ? `，同期 ${r.benchmark.toUpperCase()} ${formatPercent(r.benchmarkChange)}` : "";
  return `期间 ${change}${bench}${r.hit ? `；${r.hit}` : ""}`;
}

export function thesisAnswer(t: ThesisView): string {
  return [
    `# 判断 #${t.id}：${t.instrumentName}`,
    "",
    `${STATUS_LABELS[t.status]} · ${t.origin === "brief" ? "研究简报开立" : "站长开立"}于 ${t.openedAt.slice(0, 10)} · 观察到 ${t.until}`,
    "",
    "## 当前的卡",
    ...cardLines(t.card),
    "",
    "## 全部修订（原文保留，按时间先后）",
    ...t.revisions.map((r) => {
      const what = r.kind === "review" ? reviewLine(r.content as Review) : r.kind === "open" || r.kind === "update" ? "（卡片内容见上）" : "";
      return `- rev${r.rev} ${r.at.slice(0, 16).replace("T", " ")} UTC · ${r.kind} · ${STATUS_LABELS[r.status]} · ${r.author}${r.price !== null ? ` · 价格 ${formatNumber(r.price)}` : ""}${r.reason ? ` · ${r.reason}` : ""}${what ? ` · ${what}` : ""}`;
    }),
    "",
    "## 回答提示",
    "- 修订只追加不覆盖：说明判断怎么变的，就按修订顺序讲。",
  ].join("\n");
}

export function thesesAnswer(list: ThesisView[]): string {
  return [
    `# ${SITE.name} 判断档案（进行中）`,
    "",
    ...(list.length ? list.map((t) => `- #${t.id} ${t.instrumentName}：${STATUS_LABELS[t.status]}，观察到 ${t.until}。${t.card.whyNow}`) : ["（没有进行中的判断）"]),
    "",
    "## 回答提示",
    "- 要看某个判断的全部修订，用同一个工具带上 id。",
  ].join("\n");
}
