import { FEED_PAGE_SIZE } from "@halalfood/core/feed";
import { computeStreak, streakLine } from "@halalfood/core/streaks";
import { listFriendsFeed } from "../../../src/lib/feed-repository";
import { getPreferences } from "../../../src/lib/preferences-repository";
import { listVisitTimestamps } from "../../../src/lib/visits";
import { json, requireUser, unavailable } from "../../../src/lib/api";

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
  const offsetParam = Number(url.searchParams.get("utcOffsetMinutes") ?? 0);
  const offset =
    Number.isFinite(offsetParam) && Math.abs(offsetParam) <= 14 * 60 ? offsetParam : 0;

  try {
    const preferences = await getPreferences(outcome.auth.userId);
    const [page, visits] = await Promise.all([
      listFriendsFeed({
        viewerId: outcome.auth.userId,
        preferences,
        cursor,
        limit: FEED_PAGE_SIZE,
      }),
      // The streak is a header on the first page only.
      cursor ? Promise.resolve(null) : listVisitTimestamps(outcome.auth.userId),
    ]);
    const streak = visits
      ? (() => {
          const state = computeStreak(visits, Date.now(), offset);
          return { ...state, line: streakLine(state) };
        })()
      : null;
    return json({ ...page, streak });
  } catch {
    return unavailable();
  }
}
