import { bboxParam } from "@/lib/core/params";
import { validateGooglePlaceQuery } from "@/lib/core/place-submission";
import { getRequestAuth } from "@/lib/auth-session";
import { getClientIp } from "@/lib/otp-rate-limit";
import {
  googleSearchResponse,
  guardedGoogleTextSearch,
  type GoogleResultExisting,
} from "@/lib/google-search-guard";
import { listedGoogleIds } from "@/lib/places";
import { locationFromRequest } from "@/lib/visitor-location";

function noStore() {
  return { "Cache-Control": "no-store" };
}

/**
 * Which Google results are already listed, so /add can link to them instead.
 * A failed lookup marks nothing; POST /api/places still refuses the duplicate.
 */
async function existingFor(
  places: Array<{ id: string; displayName: string; formattedAddress: string }>,
): Promise<Array<GoogleResultExisting | null>> {
  try {
    const listed = await listedGoogleIds(places.map((place) => place.id));
    return places.map((place) => {
      const id = listed.get(place.id);
      return id ? { status: "listed" as const, placeId: id, name: place.displayName, url: `/place/${id}` } : null;
    });
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
