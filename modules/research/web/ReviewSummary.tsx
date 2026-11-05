// How the judgments turned out, as a few rows (the judgment archive and Monday's brief).
import { formatPercent, type ReviewGroup, type ReviewStats } from "../contract.ts";

function Row({ g }: { g: ReviewGroup }) {
  return (
    <tr className="border-t border-line-soft">
      <td className="py-1.5 pr-3 text-ink-2">{g.label}</td>
      <td className="num py-1.5 pr-3">{g.ended}</td>
      <td className="num py-1.5 pr-3">{g.triggered} / {g.invalidated} / {g.expired} / {g.withdrawn}</td>
      <td className="num py-1.5 pr-3">{g.hitRate === null ? "—" : formatPercent(g.hitRate, 0).replace("+", "")}</td>
      <td className="num py-1.5 pr-3">{formatPercent(g.meanChange)}</td>
      <td className="num py-1.5">{formatPercent(g.meanExcess)}</td>
    </tr>
  );
}

export function ReviewSummary({ stats, title }: { stats: ReviewStats; title: string }) {
  const rows = [stats.overall, ...stats.byMarket, ...stats.byEvidence];
  return (
    <section className="mb-8">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {stats.overall.ended === 0 ? <p className="mt-2 text-[13px] text-ink-4">这段时间没有结束的判断。</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[12.5px] text-ink-3">
            <thead><tr className="text-ink-4"><th className="pb-1 pr-3 font-normal">分组</th><th className="pb-1 pr-3 font-normal">结束</th><th className="pb-1 pr-3 font-normal">触发 / 失效 / 到期 / 撤销</th><th className="pb-1 pr-3 font-normal">命中率</th><th className="pb-1 pr-3 font-normal">平均涨跌</th><th className="pb-1 font-normal">平均超额</th></tr></thead>
            <tbody>{rows.map((g, i) => <Row key={`${g.label}-${i}`} g={g} />)}</tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[12px] leading-[1.7] text-ink-4">{stats.note}</p>
    </section>
  );
}
