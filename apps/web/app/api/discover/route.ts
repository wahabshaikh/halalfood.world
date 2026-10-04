import {
  parseDiscoveryFilters,
  filtersFromStandards,
} from "@halalfood/core/discovery-filters";
import {
  DiscoveryBboxTooLargeError,
  discoverPlaces,
  discoveryBboxExceedsCap,
} from "../../../src/lib/discovery";
import { mapSocialFor } from "../../../src/lib/map-social-repository";
import { getPreferences } from "../../../src/lib/preferences-repository";
import { bboxParam, citySlugParam, limitParam } from "@halalfood/core/params";
import {
  badRequest,
  json,
  optionalUser,
  unauthorized,
  unavailable,
} from "../../../src/lib/api";
import { domainFailure } from "../../../src/lib/domain-error";

/**
 * Filtered discovery for the map, the list and every server-rendered listing.
 *
 * `bbox` is what makes "search this area" explicit: the client only sends a new
 * viewport when the person asks for it, so panning never silently reruns the
 * query.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  let bbox;
  let limit;
  try {
    bbox = params.get("bbox") ? bboxParam(params.get("bbox")) : undefined;
    limit = limitParam(params.get("limit"));
  } catch (error) {
    return badRequest((error as Error).message);
  }
  if (bbox && discoveryBboxExceedsCap(bbox)) {
    return badRequest("Zoom in to search a smaller area.");
  }

  const citySlug = citySlugParam(params.get("city")) ?? undefined;
  // Both parameters must actually be present: Number(null) is 0, which would
  // otherwise read as Null Island and quietly enable distance sorting.
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const origin =
    rawLat !== null &&
    rawLng !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
      ? { lat, lng }
      : null;

  let filters = parseDiscoveryFilters(params);

  // Whose places to show, and friend pins, depend on who is asking, so those
  // requests are never shared through the cache. Everything else keeps the
  // public cache and never even looks the viewer up.
  const wantsSocial = filters.whose !== "everyone" || params.get("social") === "1";
  let viewerId: string | null = null;
  if (wantsSocial) {
    viewerId = await optionalUser(request);
    if (!viewerId && filters.whose !== "everyone")
      return unauthorized(
        "/map?" + params.toString(),
        "Sign in to see your places and your friends’ places.",
      );
  }

  // "Apply my standards" is resolved server-side but returned to the client so
  // the UI can show exactly which filters it turned on.
  if (filters.applyMyStandards) {
    const userId = await optionalUser(request);
    if (userId) {
      try {
        const preferences = await getPreferences(userId);
        const derived = filtersFromStandards(preferences);
        filters = {
          ...filters,
          statuses: filters.statuses.length ? filters.statuses : derived.statuses,
          facts: [...new Set([...filters.facts, ...derived.facts])],
        };
      } catch (error) {
        return domainFailure("Applying your standards", error);
      }
    }
  }

  try {
    const result = await discoverPlaces({ filters, bbox, citySlug, origin, limit, viewerId });
    const social =
      wantsSocial && viewerId
        ? await mapSocialFor(
            viewerId,
            result.places.map((place) => place.id),
          )
        : undefined;
    return json(
      { ...result, filters, ...(social ? { social } : {}) },
      {
        headers: {
          "Cache-Control":
            filters.applyMyStandards || wantsSocial
              ? "no-store"
              : "public, max-age=30, s-maxage=60",
        },
      },
    );
  } catch (error) {
    if (error instanceof DiscoveryBboxTooLargeError) return badRequest(error.message);
    return unavailable("Places are temporarily unavailable. Please try again.");
  }
}
