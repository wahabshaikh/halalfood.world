import {
  parseDiscoveryFilters,
  filtersFromStandards,
} from "../../../src/lib/discovery-filters";
import { discoverPlaces } from "../../../src/lib/discovery";
import { getPreferences } from "../../../src/lib/preferences-repository";
import { bboxParam, citySlugParam, limitParam } from "../../../src/lib/params";
import { badRequest, json, optionalUser, unavailable } from "../../../src/lib/api";

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
      } catch {
        return unavailable();
      }
    }
  }

  try {
    const result = await discoverPlaces({ filters, bbox, citySlug, origin, limit });
    return json(
      { ...result, filters },
      {
        headers: {
          "Cache-Control": filters.applyMyStandards ? "no-store" : "public, max-age=30",
        },
      },
    );
  } catch {
    return unavailable("Places are temporarily unavailable. Please try again.");
  }
}
