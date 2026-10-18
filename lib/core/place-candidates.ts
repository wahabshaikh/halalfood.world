/**
 * Ranking listed places against a name and a location, for the Scout importer
 * (find_place, and upsert_place before it creates anything). Pure: the SQL that
 * gathers candidates lives in lib/scout/places.ts.
 *
 * Older rows may carry approximate city-centre coordinates, so a candidate is
 * scored two ways and keeps the better: by distance when both sides have
 * coordinates, and by city plus street address. A shared name alone, in the
 * same city, is never enough to call two places the same (chains have many
 * branches).
 */
import { normalizeText } from "./media-match";

export const DEFAULT_RADIUS_METERS = 300;
export const MAX_RADIUS_METERS = 2000;
/** At or above this a candidate is the same place: upsert_place returns it instead of creating one. */
export const SAME_PLACE_SCORE = 0.85;

/** Words that say what a venue is, not which one it is. */
const GENERIC = new Set([
  "the", "and", "of", "at", "in", "restaurant", "restaurants", "cafe", "kitchen", "house", "grill", "halal",
  "food", "foods", "takeaway", "express", "ltd", "limited", "shop", "co", "bar",
]);

export type LatLng = { lat: number; lng: number };

export type PlaceQuery = {
  name: string;
  city?: string | null;
  /** City slug of `city`, for comparing with places.city_slug. */
  citySlug?: string | null;
  address?: string | null;
  location?: LatLng | null;
  radiusMeters: number;
  googlePlaceId?: string | null;
};

export type CandidateRow = {
  id: string;
  name: string;
  citySlug: string;
  streetAddress: string;
  addressLocality: string | null;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
};

export type RankedCandidate<T extends CandidateRow> = T & {
  score: number;
  distanceMeters: number | null;
  matchedBy: "google_place_id" | "name_and_location" | "name_and_address";
};

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A lat/lng box that contains the circle, for an indexed range query. */
export function boundingBox(center: LatLng, radiusMeters: number) {
  const dLat = (radiusMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const cos = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const dLng = Math.min(180, dLat / cos);
  return { minLat: center.lat - dLat, maxLat: center.lat + dLat, minLng: center.lng - dLng, maxLng: center.lng + dLng };
}

/** Clamp a requested radius to 1 m – MAX_RADIUS_METERS, defaulting to DEFAULT_RADIUS_METERS. */
export function clampRadius(value: unknown): number {
  const radius = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_RADIUS_METERS;
  return Math.min(MAX_RADIUS_METERS, Math.max(1, Math.round(radius)));
}

function words(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !GENERIC.has(word));
}

/**
 * Words worth an instr() search for this name: its distinctive words, longest
 * first. A name made only of generic words searches for itself.
 */
export function nameSearchTerms(name: string, max = 4): string[] {
  const distinctive = [...new Set(words(name))].sort((a, b) => b.length - a.length).slice(0, max);
  if (distinctive.length) return distinctive;
  const whole = name.trim().toLowerCase();
  return whole ? [whole] : [];
}

/** 0–1: how surely two names name the same venue. */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeText(a).replace(/ /g, "");
  const right = normalizeText(b).replace(/ /g, "");
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftWords = new Set(words(a));
  const rightWords = new Set(words(b));
  const sameWords = leftWords.size > 0 && leftWords.size === rightWords.size && [...leftWords].every((word) => rightWords.has(word));
  if (sameWords) return 0.95;
  if (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left))) return 0.9;
  if (!leftWords.size || !rightWords.size) return 0;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return Math.round(((2 * shared) / (leftWords.size + rightWords.size)) * 0.85 * 100) / 100;
}

/** The street part of an address, normalised: "12 High St, London" → "12 high st". */
function street(value: string | null | undefined): string {
  return normalizeText((value ?? "").split(",")[0] ?? "");
}

function sameCity(query: PlaceQuery, row: CandidateRow): boolean {
  if (query.citySlug && row.citySlug === query.citySlug) return true;
  const city = query.city ? normalizeText(query.city) : "";
  return Boolean(city) && normalizeText(row.addressLocality ?? "") === city;
}

/** Score one candidate, or null when it is outside the radius and not in the city. */
export function scoreCandidate<T extends CandidateRow>(query: PlaceQuery, row: T): RankedCandidate<T> | null {
  const distance =
    query.location && row.lat !== null && row.lng !== null ? distanceMeters(query.location, { lat: row.lat, lng: row.lng }) : null;
  if (query.googlePlaceId && row.googlePlaceId === query.googlePlaceId)
    return { ...row, score: 1, distanceMeters: distance === null ? null : Math.round(distance), matchedBy: "google_place_id" };
  const name = nameSimilarity(query.name, row.name);
  if (name === 0) return null;
  let byLocation = -1;
  if (distance !== null && distance <= query.radiusMeters) byLocation = name * 0.75 + (1 - distance / query.radiusMeters) * 0.25;
  let byAddress = -1;
  if (sameCity(query, row)) {
    const sameStreet = Boolean(query.address) && street(query.address) !== "" && street(query.address) === street(row.streetAddress);
    byAddress = name * 0.75 + 0.05 + (sameStreet ? 0.2 : 0);
  }
  const score = Math.max(byLocation, byAddress);
  if (score < 0) return null;
  return {
    ...row,
    score: Math.round(Math.min(1, score) * 100) / 100,
    distanceMeters: distance === null ? null : Math.round(distance),
    matchedBy: byLocation >= byAddress ? "name_and_location" : "name_and_address",
  };
}

/** Candidates best first: score, then distance, then name. */
export function rankCandidates<T extends CandidateRow>(query: PlaceQuery, rows: readonly T[], limit = 5): RankedCandidate<T>[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => !seen.has(row.id) && seen.add(row.id))
    .flatMap((row) => {
      const ranked = scoreCandidate(query, row);
      return ranked ? [ranked] : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, Math.max(1, limit));
}
