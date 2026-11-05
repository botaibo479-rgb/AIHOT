// /calendar: the events of the next weeks in three groups that are never mixed: official schedules,
// tentative plans, and speculation.
import { useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import { apiGet, cachedPage } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { AsideCard, ReadingLayout } from "@aihot/web/components/ui/Page";
import { Badge } from "@aihot/web/components/ui/Badge";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { ENTITIES } from "@aihot/industry/taxonomy";
import { formatEventDate, type EventList, type EventView } from "../contract.ts";

export const handle: Screen = { tab: "me", name: "事件日历" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";

export async function loader({ request }: { request: Request }) {
  return cachedPage(30, await apiGet<EventList>("/api/research/events?days=45", { signal: request.signal }));
}

export function meta() {
  return pageMeta({ title: "事件日历", description: `${SITE.name} 的事件日历：正式日程、暂定安排和研究推测分开列。`, path: "/calendar" });
}

const ORIGIN = { calendar: "官方日程表", article: "公开报道", owner: "我记的" } as const;

function EventRow({ event }: { event: EventView }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num shrink-0 whitespace-nowrap text-[13px] text-ink-3">{formatEventDate(event)}</span>
        <span className="text-[14px] font-medium text-ink">{event.title}</span>
        {event.entities.map((id) => <Badge key={id}>{ENTITIES[id]?.name ?? id}</Badge>)}
      </div>
      <p className="mt-1 text-[12px] leading-[1.7] text-ink-4">
        {ORIGIN[event.origin]}{event.articles.length > 1 ? ` · ${event.articles.length} 篇报道` : ""}
        {event.url && <> · <a href={event.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">出处</a></>}
        {event.quote && <> · 原文：“{event.quote}”</>}
      </p>
    </li>
  );
}

function Group({ title, note, events }: { title: string; note: string; events: EventView[] }) {
  return (
    <section className="mb-8">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-[12.5px] text-ink-3">{note}</p>
      {events.length ? (
        <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-surface">
          {events.map((e) => <EventRow key={e.id} event={e} />)}
        </ul>
      ) : <p className="mt-3 text-[13px] text-ink-4">暂无</p>}
    </section>
  );
}

export default function CalendarPage() {
  const data = useLoaderData<typeof loader>();
  const aside = (
    <AsideCard title="这些事件从哪来">
      <p className="text-[13px] leading-[1.75] text-ink-3">
        官方日程表每年手录一次（议息、非农、CPI……）；其余是模型从最近的精选和高分报道里读出来的，每条都带原文出处。
        读错了的，用推送令牌调用 <code>POST /api/research/events/&lt;id&gt;/withdraw</code> 撤下（会留下记录）。
      </p>
      <p className="mt-2 text-[12px] leading-[1.7] text-ink-4">{data.note}</p>
    </AsideCard>
  );
  return (
    <>
      <PhoneBar back={{ to: "/more", label: "我的" }} title="事件日历" />
      <ReadingLayout aside={aside}>
        <header className="pb-6">
          <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">事件日历</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">{data.from} 至 {data.to}，时间按北京日期。</p>
        </header>
        <Group title="正式日程" note="机构已经公布的日期。" events={data.official} />
        <Group title="暂定安排" note="计划、预计，或机构自己标为暂定的日期，可能改期。" events={data.tentative} />
        <Group title="研究推测" note="只是有人这样猜，不是日程，不给概率。" events={data.speculative} />
      </ReadingLayout>
    </>
  );
}
