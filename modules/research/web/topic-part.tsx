// The quote of a topic's instruments, above its reports (routes/topic.tsx draws it).
import type { TopicPagePart } from "@aihot/web/modules";
import { FLAG_NOTE, type InstrumentView } from "../contract.ts";
import { QuoteCard } from "./QuoteCard.tsx";

const views = (data: unknown) => (Array.isArray(data) ? (data as InstrumentView[]) : []);

const part: TopicPagePart = {
  name: "行情",
  shows: (data) => views(data).length > 0,
  Block: ({ data }) => (
    <section aria-label="行情">
      <div className="space-y-2">
        {views(data).map((v) => <QuoteCard key={v.id} view={v} />)}
      </div>
      {views(data).some((v) => v.flags.length) && <p className="mt-2 text-[12px] text-ink-4">{FLAG_NOTE}</p>}
    </section>
  ),
  entries: () => [],
  news: () => [],
};

export default part;
