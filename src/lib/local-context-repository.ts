import { discoverPlaces, type DiscoveredPlace } from "./discovery";
import { EMPTY_FILTERS } from "./discovery-filters";
import {
  boundingBox,
  buildLocalContext,
  LOCAL_RADIUS_KM,
  type LocalContext,
} from "./local-context";
import { listCities } from "./places";
import { getVisitorLocation, type VisitorLocation } from "./visitor-location";

/** The visitor's location plus every listed city ranked around it. */
export async function loadLocalContext(
  location?: VisitorLocation | null,
): Promise<LocalContext> {
  const resolved = location === undefined ? await getVisitorLocation() : location;
  const cities = await listCities({ limit: 2000 });
  return buildLocalContext(cities, resolved);
}

/** Closest places to a point, nearest first, within a radius. */
export async function findPlacesNear(
  origin: { lat: number; lng: number },
  options: { limit?: number; radiusKm?: number; excludeId?: string } = {},
): Promise<DiscoveredPlace[]> {
  const radiusKm = options.radiusKm ?? LOCAL_RADIUS_KM;
  const limit = options.limit ?? 12;
  const result = await discoverPlaces({
    filters: { ...EMPTY_FILTERS, sort: "distance", maxDistanceKm: radiusKm },
    bbox: boundingBox(origin, radiusKm),
    origin,
    limit: options.excludeId ? limit + 1 : limit,
  });
  return result.places
    .filter((place) => place.id !== options.excludeId && place.halal_status !== "not-halal")
    .slice(0, limit);
}
