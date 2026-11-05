// /watchlist: the instruments on the watchlist, the ones nominated by how much they are reported, and the
// market background (rates, the dollar, indices), each with its quote and screening flags.
import { useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import { apiGet, cachedPage } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { AsideCard, ReadingLayout } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import type { InstrumentList, InstrumentView } from "../contract.ts";
import { QuoteCard } from "./QuoteCard.tsx";

export const handle: Screen = { tab: "me", name: "观察清单" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";

export async function loader({ request }: { request: Request }) {
  return cachedPage(30, await apiGet<InstrumentList>("/api/research/instruments", { signal: request.signal }));
}

export function meta() {
  return pageMeta({ title: "观察清单", description: `${SITE.name} 的观察清单、提名中的标的和市场背景行情。`, path: "/watchlist" });
}

function Section({ title, note, views }: { title: string; note?: string; views: InstrumentView[] }) {
  return (
    <section className="mb-8">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {note && <p className="mt-1 text-[12.5px] text-ink-3">{note}</p>}
      <div className="mt-3 space-y-2">
        {views.length ? views.map((v) => <QuoteCard key={v.id} view={v} />) : <p className="text-[13px] text-ink-4">暂无</p>}
      </div>
    </section>
  );
}

export default function WatchlistPage() {
  const data = useLoaderData<typeof loader>();
  const all = data.instruments;
  const state = (s: string) => all.filter((v) => v.watch?.state === s);
  const others = all.filter((v) => v.role === "candidate" && !v.watch);
  const aside = (
    <AsideCard title="怎么用">
      <p className="text-[13px] leading-[1.75] text-ink-3">
        标的不预先写死：每天按报道的聚合程度提名（几天内有足够多的独立来源在报道），你再决定是否观察。
        用 Agent 或脚本带上推送令牌调用 <code>POST /api/research/watch/&lt;id&gt;</code>，state 写 watching 或 dropped。
      </p>
      <p className="mt-2 text-[12px] leading-[1.7] text-ink-4">{data.flagNote}</p>
    </AsideCard>
  );
  return (
    <>
      <PhoneBar back={{ to: "/more", label: "我的" }} title="观察清单" />
      <ReadingLayout aside={aside}>
        <header className="pb-6">
          <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">观察清单</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">价格和变化都带着数据来源和时间；标记只是按阈值筛出的提示。</p>
        </header>
        <Section title="观察中" views={state("watching")} />
        <Section title="已提名，等你确认" note="按报道聚合程度自动提名。" views={state("nominated")} />
        <Section title="市场背景" note="指数、利率、美元和汇率：不提名，总在这里。" views={all.filter((v) => v.role === "context")} />
        <Section title="其他可查的标的" views={others} />
        {state("dropped").length > 0 && <Section title="已放弃" views={state("dropped")} />}
      </ReadingLayout>
    </>
  );
}
