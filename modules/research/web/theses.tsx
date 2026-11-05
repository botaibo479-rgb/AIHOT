// /theses: the judgment archive. Each judgment shows its card as it stands and every revision as written,
// oldest first: what it said, when it changed, why, and how it ended.
import { useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import { apiGet, cachedPage } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { AsideCard, ReadingLayout } from "@aihot/web/components/ui/Page";
import { Badge } from "@aihot/web/components/ui/Badge";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { OPEN_STATUSES, STATUS_LABELS, formatNumber, formatPercent, type Review, type ReviewStats, type Revision, type ThesisView } from "../contract.ts";
import { CardView } from "./CardView.tsx";
import { ReviewSummary } from "./ReviewSummary.tsx";

export const handle: Screen = { tab: "me", name: "判断档案" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";

export async function loader({ request }: { request: Request }) {
  const [list, review] = await Promise.all([
    apiGet<{ theses: ThesisView[] }>("/api/research/theses", { signal: request.signal }),
    apiGet<ReviewStats>("/api/research/review?days=30", { signal: request.signal }),
  ]);
  return cachedPage(30, { ...list, review });
}

export function meta() {
  return pageMeta({ title: "判断档案", description: `${SITE.name} 的判断档案：每条判断的全部修订与复盘。`, path: "/theses" });
}

const KIND = { open: "开立", update: "更新", status: "状态", review: "复盘", note: "笔记" } as const;
const AUTHOR = { model: "模型", rule: "规则核对", owner: "站长" } as const;

function RevisionRow({ r }: { r: Revision }) {
  const review = r.kind === "review" ? (r.content as Review) : null;
  return (
    <li className="text-[12.5px] leading-[1.7] text-ink-3">
      <span className="num text-ink-4">rev{r.rev} · {r.at.slice(0, 16).replace("T", " ")} UTC</span> · {KIND[r.kind]} · {STATUS_LABELS[r.status]} · {AUTHOR[r.author]}
      {r.price !== null && <> · 价格 <span className="num">{formatNumber(r.price)}</span></>}
      {r.reason && <> · {r.reason}</>}
      {review && <> · 期间 <span className="num">{formatPercent(review.change)}</span>{review.benchmark && review.benchmarkChange !== null && <>，同期 {review.benchmark.toUpperCase()} <span className="num">{formatPercent(review.benchmarkChange)}</span></>}</>}
    </li>
  );
}

function Thesis({ t }: { t: ThesisView }) {
  const open = OPEN_STATUSES.includes(t.status);
  return (
    <article id={`t-${t.id}`} className="scroll-mt-6 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-ink">#{t.id} {t.instrumentName}</span>
        <Badge tone={t.status === "triggered" ? "ok" : t.status === "invalidated" ? "hot" : open ? "accent" : "neutral"}>{STATUS_LABELS[t.status]}</Badge>
        <span className="text-[12px] text-ink-4">{t.origin === "brief" ? "研究简报开立" : "站长开立"} · {t.openedAt.slice(0, 10)} · 观察到 {t.until}</span>
      </div>
      <div className="mt-3"><CardView card={t.card} /></div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[12.5px] text-accent">全部修订（{t.revisions.length}，原文保留）</summary>
        <ul className="mt-2 space-y-1">{t.revisions.map((r) => <RevisionRow key={r.rev} r={r} />)}</ul>
      </details>
    </article>
  );
}

export default function ThesesPage() {
  const { theses, review } = useLoaderData<typeof loader>();
  const open = theses.filter((t) => OPEN_STATUSES.includes(t.status));
  const ended = theses.filter((t) => !OPEN_STATUSES.includes(t.status));
  const aside = (
    <AsideCard title="规则">
      <p className="text-[13px] leading-[1.75] text-ink-3">
        判断不改写：每次变化都追加一条修订，写明时间、原因和是谁。带价位的触发、失效条件每天按价格核对，过了观察期自动到期，结束时自动复盘。
        自己的笔记和决定用推送令牌调用 <code>POST /api/research/theses/&lt;id&gt;/revisions</code>。
      </p>
    </AsideCard>
  );
  return (
    <>
      <PhoneBar back={{ to: "/more", label: "我的" }} title="判断档案" />
      <ReadingLayout aside={aside}>
        <header className="pb-6">
          <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">判断档案</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">进行中 {open.length} 条，已结束 {ended.length} 条。</p>
        </header>
        <ReviewSummary stats={review} title="最近 30 天的复盘" />
        <section className="mb-8">
          <h2 className="text-[15px] font-semibold text-ink">进行中</h2>
          <div className="mt-3 space-y-3">{open.length ? open.map((t) => <Thesis key={t.id} t={t} />) : <p className="text-[13px] text-ink-4">暂无</p>}</div>
        </section>
        <section className="mb-8">
          <h2 className="text-[15px] font-semibold text-ink">已结束</h2>
          <div className="mt-3 space-y-3">{ended.length ? ended.map((t) => <Thesis key={t.id} t={t} />) : <p className="text-[13px] text-ink-4">暂无</p>}</div>
        </section>
      </ReadingLayout>
    </>
  );
}
