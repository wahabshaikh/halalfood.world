import { FEED_PAGE_SIZE } from "@halalfood/core/feed";
import { listFriendsFeed } from "../../../src/lib/feed-repository";
import { getPreferences } from "../../../src/lib/preferences-repository";
import { json, requireUser } from "../../../src/lib/api";
import { domainFailure } from "../../../src/lib/domain-error";

/**
 * The friends feed for the signed-in diner: their own shared visits and those
 * of the people they follow, filtered by their own dietary standard. It is
 * personal, so it is never cached.
 */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/feed");
  if (!outcome.ok) return outcome.response;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  try {
    const preferences = await getPreferences(outcome.auth.userId);
    const page = await listFriendsFeed({
      viewerId: outcome.auth.userId,
      preferences,
      cursor,
      limit: FEED_PAGE_SIZE,
    });
    return json(page);
  } catch (error) {
    return domainFailure("Your friends feed", error);
  }
}
