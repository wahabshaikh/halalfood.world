import { discoverPlaces } from "../../../../src/lib/discovery";
import { json, requireUser, unavailable } from "../../../../src/lib/api";
import { onboardingPickQueries } from "../../../../src/lib/onboarding-picks";

const PICK_COUNT = 8;

/**
 * Places to seed "want to try". A standard the person actually chose narrows
 * the list. Skipping that step, or a standard that matches nothing, still
 * returns listed places so the step is not empty.
 */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/onboarding");
  if (!outcome.ok) return outcome.response;

  const queries = onboardingPickQueries(new URL(request.url).searchParams);
  try {
    let result = await discoverPlaces({ ...queries[0], limit: PICK_COUNT });
    let relaxed = false;
    for (let index = 1; index < queries.length && result.places.length === 0; index += 1) {
      result = await discoverPlaces({ ...queries[index], limit: PICK_COUNT });
      relaxed = true;
    }
    return json({
      relaxed,
      places: result.places.map((place) => ({
        id: place.id,
        name: place.name,
        citySlug: place.city_slug,
        neighbourhood: place.neighbourhood ?? null,
        halalStatus: place.halal_status,
      })),
    });
  } catch {
    return unavailable("Places are temporarily unavailable. Please try again.");
  }
}
