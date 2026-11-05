// /brief: the latest daily research brief: candidates with their cards, leads, what changed in the open
// judgments, the next three weeks' events and the market background.
import { Link, useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import { apiGet, cachedPage } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { AsideCard, ReadingLayout } from "@aihot/web/components/ui/Page";
import { Badge } from "@aihot/web/components/ui/Badge";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { STATUS_LABELS, formatEventDate, type Brief, type BriefEntry, type EventView } from "../contract.ts";
import { CardView } from "./CardView.tsx";
import { QuoteCard } from "./QuoteCard.tsx";
import { ReviewSummary } from "./ReviewSummary.tsx";

export const handle: Screen = { tab: "me", name: "研究简报" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";

export async function loader({ request }: { request: Request }) {
  return cachedPage(60, await apiGet<{ brief: Brief | null }>("/api/research/briefs/latest", { signal: request.signal }));
}

export function meta() {
  return pageMeta({ title: "研究简报", description: `${SITE.name} 每天的研究简报：候选标的、证据与缺口、触发与失效条件。`, path: "/brief" });
}

function Entry({ entry }: { entry: BriefEntry }) {
  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <QuoteCard view={entry.instrument} />
      <div className="mt-3">
        <CardView card={entry.card} />
      </div>
      {entry.thesisId && <p className="mt-2 text-[12px] text-ink-4">已开立判断 <Link to={`/theses#t-${entry.thesisId}`} className="text-accent hover:underline">#{entry.thesisId}</Link></p>}
    </article>
  );
}

function EventLines({ label, events }: { label: string; events: EventView[] }) {
  if (!events.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[13px] font-medium text-ink-2">{label}</p>
      <ul className="mt-1 space-y-0.5 text-[13px] text-ink-3">
        {events.map((e) => <li key={e.id}><span className="num">{formatEventDate(e)}</span> {e.title}</li>)}
      </ul>
    </div>
  );
}

export default function BriefPage() {
  const { brief } = useLoaderData<typeof loader>();
  const aside = (
    <AsideCard title="怎么读">
      <p className="text-[13px] leading-[1.75] text-ink-3">{brief?.note ?? "研究简报每天 08:45（北京时间）生成一次，写好后不改。"}</p>
      <p className="mt-2 text-[12px] leading-[1.7] text-ink-4">候选会开立一条判断，之后每天按价格核对触发和失效条件，结束时自动复盘。全部修订在判断档案里。</p>
    </AsideCard>
  );
  return (
    <>
      <PhoneBar back={{ to: "/more", label: "我的" }} title="研究简报" />
      <ReadingLayout aside={aside}>
        <header className="pb-6">
          <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">研究简报{brief ? ` · ${brief.day}` : ""}</h1>
          {brief && <p className="mt-1.5 text-[13px] text-ink-3">生成于 {brief.generatedAt.slice(0, 16).replace("T", " ")} UTC</p>}
        </header>
        {!brief ? <p className="text-[14px] text-ink-3">还没有生成过研究简报。</p> : (
          <>
            <section className="mb-8">
              <h2 className="text-[15px] font-semibold text-ink">优先关注（{brief.candidates.length}）</h2>
              <div className="mt-3 space-y-3">
                {brief.candidates.length ? brief.candidates.map((e) => <Entry key={e.instrument.id} entry={e} />) : <p className="text-[13px] text-ink-4">今天没有合格候选。</p>}
              </div>
            </section>
            <section className="mb-8">
              <h2 className="text-[15px] font-semibold text-ink">线索（{brief.leads.length}）</h2>
              <p className="mt-1 text-[12.5px] text-ink-3">证据不足或只有叙事信号，只记录，不开立判断。</p>
              <div className="mt-3 space-y-3">
                {brief.leads.length ? brief.leads.map((e) => <Entry key={e.instrument.id} entry={e} />) : <p className="text-[13px] text-ink-4">暂无</p>}
              </div>
            </section>
            <section className="mb-8">
              <h2 className="text-[15px] font-semibold text-ink">已有判断更新</h2>
              <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
                {brief.updates.length ? brief.updates.map((u) => (
                  <li key={u.thesisId}><Link to={`/theses#t-${u.thesisId}`} className="text-accent hover:underline">#{u.thesisId}</Link> {u.instrumentName}：<Badge>{STATUS_LABELS[u.from]}</Badge> → <Badge tone={u.to === "triggered" ? "ok" : u.to === "invalidated" ? "hot" : "neutral"}>{STATUS_LABELS[u.to]}</Badge> {u.reason}</li>
                )) : <li className="text-ink-4">今天没有变化</li>}
                {brief.open.map((o) => <li key={o.thesisId} className="text-ink-3"><Link to={`/theses#t-${o.thesisId}`} className="text-accent hover:underline">#{o.thesisId}</Link> {o.instrumentName}：{STATUS_LABELS[o.status]}，观察到 {o.until}</li>)}
              </ul>
            </section>
            <section className="mb-8">
              <h2 className="text-[15px] font-semibold text-ink">未来 3 周事件</h2>
              <EventLines label="正式日程" events={brief.events.official} />
              <EventLines label="暂定安排" events={brief.events.tentative} />
              <EventLines label="研究推测（不是日程）" events={brief.events.speculative} />
              <p className="mt-2 text-[12px] text-ink-4"><Link to="/calendar" className="text-accent hover:underline">完整的事件日历</Link></p>
            </section>
            <section className="mb-8">
              <h2 className="text-[15px] font-semibold text-ink">市场背景</h2>
              <div className="mt-3 space-y-2">{brief.context.filter((v) => v.quote).map((v) => <QuoteCard key={v.id} view={v} />)}</div>
            </section>
            {brief.weekly && <ReviewSummary stats={brief.weekly} title="上周复盘" />}
            {brief.problems.length > 0 && (
              <section className="mb-8">
                <h2 className="text-[15px] font-semibold text-ink">生成时的问题</h2>
                <ul className="mt-2 space-y-1 text-[12.5px] text-ink-3">{brief.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </section>
            )}
          </>
        )}
      </ReadingLayout>
    </>
  );
}
