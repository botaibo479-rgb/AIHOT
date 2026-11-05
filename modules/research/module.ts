// The research module's addresses: the brief, watchlist, calendar and judgment pages, and the JSON they read
// (server.ts).
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "research",
  pages: [
    { path: "brief", file: "web/brief.tsx", id: "research-brief" },
    { path: "watchlist", file: "web/watchlist.tsx", id: "research-watchlist" },
    { path: "calendar", file: "web/calendar.tsx", id: "research-calendar" },
    { path: "theses", file: "web/theses.tsx", id: "research-theses" },
  ],
  apiPaths: [/^\/api\/research(?:\/|$)/],
});
