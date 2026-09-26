import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { trackAICrawlerRequest } from "@datafast/ai-crawl";
import { withVisitorHeaders } from "./src/lib/visitor-location";

export function proxy(request: NextRequest, event: NextFetchEvent) {
  trackAICrawlerRequest(request, event, {
    websiteId: "dfid_ZgOOfrW4AAKMqIY9gqUEs",
  });

  // Pages read the visitor's approximate location through headers(), so the
  // first screen can show what's near them instead of a generic list.
  return NextResponse.next({ request: { headers: withVisitorHeaders(request) } });
}

export const config = {
  // Keep robots.txt, llms.txt, and sitemap files reachable by this proxy.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
