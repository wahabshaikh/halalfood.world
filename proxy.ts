import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { trackAICrawlerRequest } from "@datafast/ai-crawl";

export function proxy(request: NextRequest, event: NextFetchEvent) {
  trackAICrawlerRequest(request, event, {
    websiteId: "dfid_ZgOOfrW4AAKMqIY9gqUEs",
  });

  return NextResponse.next();
}

export const config = {
  // Keep robots.txt, llms.txt, and sitemap files reachable by this proxy.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
