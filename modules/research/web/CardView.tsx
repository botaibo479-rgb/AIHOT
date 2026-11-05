// A candidate card: why now, the three kinds of evidence with where each comes from, the gaps, and the
// conditions that would make it or end it (the brief and the judgment archive).
import type { Card, Evidence } from "../contract.ts";

function EvidenceRow({ label, items }: { label: string; items: Evidence[] }) {
  return (
    <div className="flex gap-3 text-[13px] leading-[1.7]">
      <span className="w-[4.5em] shrink-0 text-ink-3">{label}</span>
      {items.length ? (
        <ul className="min-w-0 space-y-0.5 text-ink-2">
          {items.map((e, i) => <li key={i}>{e.claim}<span className="ml-1 text-[11.5px] text-ink-4">（{e.ref.startsWith("a:") ? "报道" : e.ref.startsWith("e:") ? `事件 #${e.ref.slice(2)}` : e.ref}）</span></li>)}
        </ul>
      ) : <span className="text-ink-4">无</span>}
    </div>
  );
}

function Lines({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex gap-3 text-[13px] leading-[1.7]">
      <span className="w-[4.5em] shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 text-ink-2">{items.length ? items.join("；") : "—"}</span>
    </div>
  );
}

export function CardView({ card }: { card: Card }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[13.5px] leading-[1.75] text-ink">{card.whyNow}</p>
      <EvidenceRow label="资本权" items={card.evidence.capital} />
      <EvidenceRow label="叙事权" items={card.evidence.narrative} />
      <EvidenceRow label="规则权" items={card.evidence.rules} />
      <Lines label="缺口" items={card.gaps} />
      <Lines label="触发" items={card.triggers.map((c) => c.text)} />
      <Lines label="失效" items={card.invalidations.map((c) => c.text)} />
      <Lines label="风险" items={card.risks} />
      <Lines label="观察期" items={[`${card.horizonDays} 天`]} />
    </div>
  );
}
