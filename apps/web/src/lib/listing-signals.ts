/**
 * Map listings as a halal signal: read the halal tag from OpenStreetMap
 * (through Overpass) or Geoapify, and match each listing to a place we list.
 * Pure functions; `scripts/import-listing-signals.ts` does the fetching.
 */
import { parseListingClaim, type ListingClaim } from "@halalfood/core/halal";
import { sameVenueName } from "./place-match";
import { distanceKm } from "./visitor-location";

export type Listing = {
  provider: "osm" | "geoapify";
  /** "node/123" for OSM; Geoapify's place_id. */
  externalId: string;
  name: string;
  lat: number;
  lng: number;
  claim: ListingClaim;
};

export type Bbox = { south: number; west: number; north: number; east: number };

/** Every OSM feature with a `diet:halal` tag in the box. */
export function overpassQuery(box: Bbox): string {
  const area = `${box.south},${box.west},${box.north},${box.east}`;
  return `[out:json][timeout:90];nwr["diet:halal"]["name"](${area});out center tags;`;
}

/** Geoapify's places search for one halal condition (`halal` or `halal.only`). */
export function geoapifyUrl(box: Bbox, condition: "halal" | "halal.only", apiKey: string): string {
  const url = new URL("https://api.geoapify.com/v2/places");
  url.searchParams.set("categories", "catering");
  url.searchParams.set("conditions", condition);
  url.searchParams.set("filter", `rect:${box.west},${box.south},${box.east},${box.north}`);
  url.searchParams.set("limit", "500");
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOverpass(body: unknown): Listing[] {
  const elements = (body as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const listings: Listing[] = [];
  for (const element of elements as Record<string, unknown>[]) {
    const tags = (element.tags ?? {}) as Record<string, unknown>;
    const claim = parseListingClaim(tags["diet:halal"]);
    const name = typeof tags.name === "string" ? tags.name.trim() : "";
    const center = (element.center ?? element) as Record<string, unknown>;
    const lat = finite(center.lat);
    const lng = finite(center.lon);
    if (!claim || !name || lat === null || lng === null) continue;
    listings.push({ provider: "osm", externalId: `${element.type}/${element.id}`, name, lat, lng, claim });
  }
  return listings;
}

/** Geoapify returns places matching the condition; the claim is what we asked for. */
export function parseGeoapify(body: unknown, claim: "only" | "yes"): Listing[] {
  const features = (body as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const listings: Listing[] = [];
  for (const feature of features as { properties?: Record<string, unknown> }[]) {
    const props = feature.properties ?? {};
    const name = typeof props.name === "string" ? props.name.trim() : "";
    const lat = finite(props.lat);
    const lng = finite(props.lon);
    const id = typeof props.place_id === "string" ? props.place_id : "";
    if (!name || !id || lat === null || lng === null) continue;
    listings.push({ provider: "geoapify", externalId: id, name, lat, lng, claim });
  }
  return listings;
}

/** Geoapify lists "halal.only" places under "halal" too; keep the stronger claim. */
export function mergeGeoapify(only: Listing[], any: Listing[]): Listing[] {
  const onlyIds = new Set(only.map((listing) => listing.externalId));
  return [...only, ...any.filter((listing) => !onlyIds.has(listing.externalId))];
}

export type PlaceForMatch = { id: string; name: string; citySlug: string; lat: number; lng: number };

/** Listings further than this from a place are never the same venue. */
export const MATCH_RADIUS_KM = 0.08;

/**
 * Pair each place with the nearest listing that has the same venue name and
 * sits within `MATCH_RADIUS_KM`. A listing is used by at most one place.
 */
export function matchListings(
  places: readonly PlaceForMatch[],
  listings: readonly Listing[],
): { placeId: string; listing: Listing }[] {
  const candidates: { placeId: string; listing: Listing; km: number }[] = [];
  for (const place of places)
    for (const listing of listings) {
      const km = distanceKm(place, listing);
      if (km <= MATCH_RADIUS_KM && sameVenueName(place.name, listing.name, place.citySlug))
        candidates.push({ placeId: place.id, listing, km });
    }
  candidates.sort((a, b) => a.km - b.km);
  const usedPlaces = new Set<string>();
  const usedListings = new Set<string>();
  const matches: { placeId: string; listing: Listing }[] = [];
  for (const { placeId, listing } of candidates) {
    const key = `${listing.provider}:${listing.externalId}`;
    if (usedPlaces.has(`${placeId}:${listing.provider}`) || usedListings.has(key)) continue;
    usedPlaces.add(`${placeId}:${listing.provider}`);
    usedListings.add(key);
    matches.push({ placeId, listing });
  }
  return matches;
}

/** The box around a set of places, padded so edge venues still match. */
export function bboxOf(places: readonly { lat: number; lng: number }[], padKm = 0.5): Bbox | null {
  if (!places.length) return null;
  const lats = places.map((place) => place.lat);
  const lngs = places.map((place) => place.lng);
  const padLat = padKm / 111;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLng = padKm / (111 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  return {
    south: Math.min(...lats) - padLat,
    west: Math.min(...lngs) - padLng,
    north: Math.max(...lats) + padLat,
    east: Math.max(...lngs) + padLng,
  };
}
