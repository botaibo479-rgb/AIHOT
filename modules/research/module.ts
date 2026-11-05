// The research module's addresses: the watchlist page and the JSON it reads (backend/http.ts).
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "research",
  pages: [{ path: "watchlist", file: "web/watchlist.tsx", id: "research-watchlist" }],
  apiPaths: [/^\/api\/research(?:\/|$)/],
});
