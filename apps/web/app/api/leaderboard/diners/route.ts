import { citySlugParam } from "@halalfood/core/params";
import { parseLeaderboardWindow } from "@halalfood/core/leaderboard";
import { avatarUrl } from "@halalfood/core/social";
import { getViewerStanding, listRankedDiners } from "../../../../src/lib/diner-leaderboard";
import { json, optionalUser, unavailable } from "../../../../src/lib/api";

/**
 * Diners ranked by verified visits: `?window=week|all` and `?city=slug` for one
 * city. The ranking is the same for everyone. A signed-in diner also gets their
 * own standing, which is why the response is never cached.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const window = parseLeaderboardWindow(url.searchParams.get("window"));
  const citySlug = citySlugParam(url.searchParams.get("city")) ?? null;
  try {
    const [ranked, viewerId] = await Promise.all([
      listRankedDiners(window, citySlug),
      optionalUser(request),
    ]);
    const you = viewerId ? await getViewerStanding(viewerId, window, citySlug) : null;
    return json({
      window,
      city: citySlug,
      diners: ranked.slice(0, 50).map(({ avatarKey, ...diner }) => ({
        ...diner,
        avatarUrl: avatarUrl(diner.handle, avatarKey),
      })),
      you,
    });
  } catch {
    return unavailable("The leaderboard is temporarily unavailable.");
  }
}
