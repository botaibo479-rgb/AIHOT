// One instrument's numbers, as the watchlist page and its topic page show them.
import { Badge } from "@aihot/web/components/ui/Badge";
import { CONFIRMATION_LABELS, WATCH_LABELS, formatEventDate, formatMove, formatNumber, formatPercent, type InstrumentView } from "../contract.ts";

const time = (iso: string, daily: boolean) => (daily ? iso.slice(0, 10) : `${iso.slice(0, 16).replace("T", " ")} UTC`);

export function QuoteCard({ view }: { view: InstrumentView }) {
  const q = view.quote;
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-ink">{view.name}</span>
        {view.watch && <Badge tone={view.watch.state === "watching" ? "accent" : view.watch.state === "nominated" ? "amber" : "neutral"}>{WATCH_LABELS[view.watch.state]}</Badge>}
        {view.flags.map((f) => <Badge key={f.key} tone="hot" title={f.detail}>{f.label}</Badge>)}
      </div>
      {q ? (
        <>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] text-ink-2">
            <span className="num text-[18px] font-semibold text-ink">{formatNumber(q.price)}{q.unit === "%" ? "%" : ""}</span>
            {q.unit && q.unit !== "%" && <span className="text-ink-4">{q.unit}</span>}
            <span>{q.daily ? "1 日" : "24 小时"} <span className="num">{formatMove(q, "1d")}</span></span>
            <span>7 日 <span className="num">{formatMove(q, "7d")}</span></span>
            {q.perp?.fundingRate != null && <span>资金费率 <span className="num">{(q.perp.fundingRate * 100).toFixed(4)}%</span>/8h</span>}
            {q.perp?.openInterestChange7d != null && <span>未平仓量 7 日 <span className="num">{formatPercent(q.perp.openInterestChange7d, 1)}</span></span>}
          </p>
          <p className="mt-1 text-[12px] text-ink-4">
            {q.label}{q.perp ? ` · 合约 ${q.perp.label}` : ""} · {time(q.at, q.daily)}{q.stale ? " · 数据已过期" : ""}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-[13px] text-ink-3">{view.quoteNote}</p>
      )}
      {view.flags.length > 0 && <p className="mt-1 text-[12px] text-ink-4">{view.flags.map((f) => f.detail).join("；")}</p>}
      {view.upcoming.length > 0 && (
        <p className="mt-1 text-[12px] text-ink-3">
          未来 21 天：{view.upcoming.slice(0, 3).map((e) => `${formatEventDate(e)} ${e.title}（${CONFIRMATION_LABELS[e.confirmation]}）`).join("；")}
        </p>
      )}
    </div>
  );
}
