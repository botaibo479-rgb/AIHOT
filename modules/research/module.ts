// The research module's addresses: the watchlist and calendar pages, and the JSON they read (server.ts).
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "research",
  pages: [
    { path: "watchlist", file: "web/watchlist.tsx", id: "research-watchlist" },
    { path: "calendar", file: "web/calendar.tsx", id: "research-calendar" },
  ],
  apiPaths: [/^\/api\/research(?:\/|$)/],
});
