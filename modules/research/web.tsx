// The research module on the web pages: the watchlist and the calendar in the sidebar and on the 我的 page,
// and the quote card on an instrument's topic page.
import { defineWebModule } from "@aihot/web/modules";
import { IconClock, IconChart } from "@aihot/web/components/icons";

export default defineWebModule({
  name: "research",
  sidebar: { section: "研究", items: [{ to: "/watchlist", label: "观察清单", icon: IconChart }, { to: "/calendar", label: "事件日历", icon: IconClock }] },
  tools: [
    { to: "/watchlist", label: "观察清单", icon: <IconChart size={20} /> },
    { to: "/calendar", label: "事件日历", icon: <IconClock size={20} /> },
  ],
  topicPage: () => import("./web/topic-part.tsx"),
});
