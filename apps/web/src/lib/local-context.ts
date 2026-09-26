/**
 * What "near you" means for a visitor: the listed cities ranked by distance
 * from their approximate location, and whether any of them is close enough to
 * call local. Everything here is a pure function of the city list and the
 * location so it can be unit tested without a database.
 */

import type { City } from "./places";
import { cityName } from "./seo";
import { distanceKm, type VisitorLocation } from "./visitor-location";

export type RankedCity = City & { distance_km: number | null };

export type LocalContext = {
  location: VisitorLocation | null;
  /** Nearest first when there is a location, otherwise largest first. */
  cities: RankedCity[];
  nearest: RankedCity | null;
  /** A listed city is within `LOCAL_RADIUS_KM` of the visitor. */
  isLocal: boolean;
  /** What to call the visitor's area in copy: their city, else the nearest listed one. */
  areaName: string | null;
};

/** Close enough that "near you" is honest. */
export const LOCAL_RADIUS_KM = 60;

/** A search box around a point, so distance queries only scan nearby rows. */
export function boundingBox(origin: { lat: number; lng: number }, radiusKm: number) {
  const dLat = radiusKm / 111;
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  const dLng = cos > 0.01 ? Math.min(radiusKm / (111 * cos), 180) : 180;
  const wrap = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;
  return {
    south: Math.max(-90, origin.lat - dLat),
    north: Math.min(90, origin.lat + dLat),
    west: dLng >= 180 ? -180 : wrap(origin.lng - dLng),
    east: dLng >= 180 ? 180 : wrap(origin.lng + dLng),
  };
}

export function rankCities(
  cities: City[],
  location: VisitorLocation | null,
): RankedCity[] {
  if (!location) return cities.map((city) => ({ ...city, distance_km: null }));
  return cities
    .map((city) => ({
      ...city,
      distance_km:
        city.center_lat === null || city.center_lng === null
          ? null
          : distanceKm(location, { lat: city.center_lat, lng: city.center_lng }),
    }))
    .sort(
      (a, b) =>
        (a.distance_km ?? Number.POSITIVE_INFINITY) -
          (b.distance_km ?? Number.POSITIVE_INFINITY) ||
        b.place_count - a.place_count,
    );
}

export function buildLocalContext(
  cities: City[],
  location: VisitorLocation | null,
): LocalContext {
  const ranked = rankCities(cities, location);
  const nearest = location ? (ranked.find((city) => city.distance_km !== null) ?? null) : null;
  const isLocal =
    nearest !== null && nearest.distance_km !== null && nearest.distance_km <= LOCAL_RADIUS_KM;
  return {
    location,
    cities: ranked,
    nearest,
    isLocal,
    areaName: location?.city ?? (nearest ? cityName(nearest.city_slug) : null),
  };
}

/** Where the map should open: on the visitor when they're local, else nearest city. */
export function initialMapView(context: LocalContext) {
  if (context.isLocal && context.location)
    return { center: [context.location.lng, context.location.lat] as [number, number], zoom: 12 };
  if (context.nearest?.center_lat != null && context.nearest.center_lng != null)
    return {
      center: [context.nearest.center_lng, context.nearest.center_lat] as [number, number],
      zoom: 11,
    };
  return null;
}
