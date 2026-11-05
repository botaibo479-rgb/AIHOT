// The Agent answers (MCP hubble_get_instrument, /api/v1/agent/instruments): the same numbers as the JSON, as
// Markdown, ending with how to tell them to the person asking.
import { SITE } from "@aihot/site";
import { MARKET_LABELS, WATCH_LABELS, formatMove, formatNumber, formatPercent, type InstrumentDetail, type InstrumentList, type InstrumentView } from "../contract.ts";

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
    ...(d.topic ? [`- 相关报道：/topics/${d.topic}`] : []),
    "",
    ...(last.length ? ["## 最近 7 个日值", ...last.map((l) => `- ${l}`), ""] : []),
    "## 回答提示",
    `- ${d.flagNote}`,
    "- 日值按数据源自己的日期：加密按 UTC 日，美股和 FRED 按美国交易日。",
  ].join("\n");
}
