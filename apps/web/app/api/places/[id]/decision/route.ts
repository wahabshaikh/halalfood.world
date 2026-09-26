import { placeIdParam } from "@halalfood/core/params";
import {
  getDecisionSummary,
  listStatusHistory,
} from "../../../../../src/lib/place-decision";
import { getPreferences } from "../../../../../src/lib/preferences-repository";
import {
  badRequest,
  json,
  optionalUser,
  unavailable,
} from "../../../../../src/lib/api";

/**
 * The decision summary: status, evidence confidence, independent facts, return
 * intent and dish highlights, plus the signed-in user's own suitability check.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const placeId = placeIdParam((await context.params).id);
  if (!placeId) return badRequest("Invalid place id.");

  const userId = await optionalUser(request);
  try {
    const preferences = userId ? await getPreferences(userId) : null;
    const [decision, history] = await Promise.all([
      getDecisionSummary(placeId, preferences),
      listStatusHistory(placeId),
    ]);
    return json(
      { decision, history },
      {
        headers: {
          "Cache-Control": userId ? "no-store" : "public, max-age=60",
        },
      },
    );
  } catch {
    return unavailable();
  }
}
