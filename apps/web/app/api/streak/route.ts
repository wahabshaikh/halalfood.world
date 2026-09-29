import { computeStreak, streakLine } from "@halalfood/core/streaks";
import { listVisitTimestamps } from "../../../src/lib/visits";
import { json, requireUser, unavailable } from "../../../src/lib/api";

/** The signed-in diner's weekly streak. Pass `utcOffsetMinutes` for their local week. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/feed");
  if (!outcome.ok) return outcome.response;
  const offsetParam = Number(new URL(request.url).searchParams.get("utcOffsetMinutes") ?? 0);
  const offset =
    Number.isFinite(offsetParam) && Math.abs(offsetParam) <= 14 * 60 ? offsetParam : 0;
  try {
    const state = computeStreak(
      await listVisitTimestamps(outcome.auth.userId),
      Date.now(),
      offset,
    );
    return json({ ...state, line: streakLine(state) });
  } catch {
    return unavailable();
  }
}
