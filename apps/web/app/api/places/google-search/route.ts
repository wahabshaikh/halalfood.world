import { bboxParam } from "@halalfood/core/params";
import { validateGooglePlaceQuery } from "@halalfood/core/place-submission";
import { getRequestAuth } from "../../../../src/lib/auth-session";
import { getClientIp } from "../../../../src/lib/otp-rate-limit";
import {
  googleSearchResponse,
  guardedGoogleTextSearch,
  type GoogleResultExisting,
} from "../../../../src/lib/google-search-guard";
import {
  citySlugFromAddress,
  findExistingPlaces,
  type ExistingPlaceMatch,
} from "../../../../src/lib/place-duplicates";
import { locationFromRequest } from "../../../../src/lib/visitor-location";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function existingCopy(match: ExistingPlaceMatch | null): GoogleResultExisting | null {
  if (!match) return null;
  if (match.kind === "listed") {
    return { status: "listed", placeId: match.placeId, name: match.name, url: `/place/${match.placeId}` };
  }
  return { status: match.kind === "pending" ? "pending" : "known", name: match.name };
}

/**
 * Which Google results are already listed or under review, so /add can turn
 * off Add for them. A failed lookup marks nothing; POST /api/places still
 * refuses the duplicate.
 */
async function existingFor(
  places: Array<{ id: string; displayName: string; formattedAddress: string }>,
): Promise<Array<GoogleResultExisting | null>> {
  try {
    const matches = await findExistingPlaces(
      places.map((place) => ({
        googlePlaceId: place.id,
        name: place.displayName,
        citySlug: citySlugFromAddress(place.formattedAddress),
        address: place.formattedAddress,
      })),
    );
    return matches.map(existingCopy);
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Reject a short query before session lookup or any Google call.
  const parsed = validateGooglePlaceQuery(params.get("q"));
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400, headers: noStore() });
  }
  const rawBbox = params.get("bbox");
  let bbox: ReturnType<typeof bboxParam> | null = null;
  if (rawBbox) {
    try {
      bbox = bboxParam(rawBbox);
    } catch (error) {
      return Response.json(
        { error: (error as Error).message },
        { status: 400, headers: noStore() },
      );
    }
  }

  const auth = await getRequestAuth(request);
  const userId = auth.status === "authenticated" ? auth.userId : null;

  try {
    const result = await guardedGoogleTextSearch({
      query: parsed.query,
      userId,
      ip: getClientIp(request),
      near: locationFromRequest(request),
      bbox,
    });
    if (result.outcome !== "results") return googleSearchResponse(result);
    return googleSearchResponse(result, await existingFor(result.places));
  } catch {
    return Response.json(
      { error: "Google search is temporarily unavailable. Please try again." },
      { status: 503, headers: noStore() },
    );
  }
}
