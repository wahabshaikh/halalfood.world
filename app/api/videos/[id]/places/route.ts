import { uuidParam } from "@/lib/core/params";
import { parsePlacePicks } from "@/lib/core/videos";
import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { consumeContributionLimits } from "@/lib/otp-rate-limit";
import { submitVideoPlaces, videoDeps } from "@/lib/videos";

/**
 * Body `{placeIds}`: the places the video shows, 1 to 10. New members' picks
 * wait for a moderator; others publish at once. 10 videos a day per member.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireUser(request, "/add/video");
  if (!outcome.ok) return outcome.response;
  const id = uuidParam((await params).id);
  if (!id) return badRequest("That video id is not valid.");
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const picks = parsePlacePicks(body);
  if (!picks.ok) return badRequest(picks.error);
  const limited = await spendBudget(consumeContributionLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await submitVideoPlaces(outcome.auth.userId, id, picks.placeIds, await videoDeps(request));
    return result.ok ? json(result.value, { status: 201 }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
