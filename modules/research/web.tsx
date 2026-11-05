// The research module on the web pages: the watchlist in the sidebar and on the 我的 page, and the quote
// card on an instrument's topic page.
import { defineWebModule } from "@aihot/web/modules";
import { IconList } from "@aihot/web/components/icons";

export default defineWebModule({
  name: "research",
  sidebar: { section: "研究", items: [{ to: "/watchlist", label: "观察清单", icon: IconList }] },
  tools: [{ to: "/watchlist", label: "观察清单", icon: <IconList size={20} /> }],
  topicPage: () => import("./web/topic-part.tsx"),
});
