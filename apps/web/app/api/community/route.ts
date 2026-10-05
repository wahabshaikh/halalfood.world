import { citySlugParam } from "@halalfood/core/params";
import { badRequest, json, optionalUser, unavailable } from "../../../src/lib/api";
import { leaderboard } from "../../../src/lib/community";
import { avatarUrl } from "../../../src/lib/profiles";

/** `?city=&period=week|all`: top 50 plus the viewer's own row. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const city = citySlugParam(params.get("city"));
  if (!city) return badRequest("Choose a city.");
  const period = params.get("period") === "all" ? "all" : "week";
  try {
    const board = await leaderboard(city, period, await optionalUser(request));
    const view = (row: (typeof board.rows)[number]) => ({ ...row, avatarUrl: avatarUrl(row.avatarKey, row.handle) });
    return json({ rows: board.rows.map(view), me: board.me?.kind === "row" ? { kind: "row", row: view(board.me.row) } : board.me });
  } catch {
    return unavailable();
  }
}
