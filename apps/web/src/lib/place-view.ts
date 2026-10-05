/**
 * The shape every place row, card and pin renders, and the SQL that produces
 * it. Places are always read joined to their `place_status` projection.
 */
import { sql, type SQL } from "drizzle-orm";
import { displayCuisines } from "@halalfood/core/listing-visibility";
import {
  FACTS,
  parseDefinite,
  parseStatus,
  type Definite,
  type Fact,
  type Filter,
  type PlaceStatus,
} from "@halalfood/core/halal";

export type FactValues = Record<Fact, Definite | null>;

export type PlaceCard = {
  id: string;
  name: string;
  citySlug: string;
  cuisine: string | null;
  area: string;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  status: PlaceStatus;
  facts: FactValues;
  photoKey: string | null;
};

/** Columns for `SELECT … FROM places p JOIN place_status s ON s.place_id = p.id`. */
export const PLACE_CARD_COLUMNS = sql.raw(`
  p.id, p.name, p.city_slug, p.serves_cuisine, p.address_locality, p.street_address,
  p.lat, p.lng, s.status, s.progress, s.owned_value, s.certified_value, s.pork_value,
  s.alcohol_value,
  (SELECT ph.r2_key FROM place_photos ph WHERE ph.place_id = p.id ORDER BY ph.created_at DESC LIMIT 1) AS photo_key
`);

export const PLACE_CARD_FROM = sql.raw(`places p JOIN place_status s ON s.place_id = p.id`);

/** Public listing rule: everything listed is public. Hidden and closed stay in the table. */
export const LISTED = sql.raw(`p.listing_status = 'listed'`);

export function parseCuisines(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function cityName(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function areaOf(row: Record<string, unknown>): string {
  const locality = typeof row.address_locality === "string" ? row.address_locality.trim() : "";
  if (locality) return locality;
  const street = typeof row.street_address === "string" ? row.street_address : "";
  const parts = street.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : cityName(String(row.city_slug ?? ""));
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toPlaceCard(row: Record<string, unknown>): PlaceCard {
  const facts = Object.fromEntries(
    FACTS.map((fact) => [fact, parseDefinite(row[`${fact}_value`])]),
  ) as FactValues;
  return {
    id: String(row.id),
    name: String(row.name),
    citySlug: String(row.city_slug),
    cuisine: displayCuisines(parseCuisines(row.serves_cuisine))[0] ?? null,
    area: areaOf(row),
    lat: num(row.lat),
    lng: num(row.lng),
    distanceKm: num(row.distance_km),
    status: parseStatus(row.status, row.progress),
    facts,
    photoKey: typeof row.photo_key === "string" ? row.photo_key : null,
  };
}

/** SQL conditions for the halal filters (spec §2.4). */
export function filterConditions(filters: readonly Filter[]): SQL[] {
  return filters.map((filter) => {
    switch (filter) {
      case "verified":
        return sql`s.status = 'verified'`;
      case "owned":
        return sql`s.owned_value = 'yes'`;
      case "certified":
        return sql`s.certified_value = 'yes'`;
      case "no-pork":
        return sql`s.pork_value = 'no'`;
      case "no-alcohol":
        return sql`s.alcohol_value = 'no'`;
    }
  });
}

/** Squared-degree distance proxy is enough to order; km uses the haversine. */
export function distanceKmSql(lat: number, lng: number): SQL {
  // D1 has no POWER(), so squares are written out.
  return sql`(6371 * 2 * ASIN(SQRT(
    (SIN(RADIANS(p.lat - ${lat}) / 2) * SIN(RADIANS(p.lat - ${lat}) / 2)) +
    COS(RADIANS(${lat})) * COS(RADIANS(p.lat)) *
    (SIN(RADIANS(p.lng - ${lng}) / 2) * SIN(RADIANS(p.lng - ${lng}) / 2))
  )))`;
}

export function formatDistance(km: number | null): string | null {
  if (km === null) return null;
  return km < 1 ? `${Math.max(0.1, Math.round(km * 10) / 10)} km` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function photoUrl(key: string | null): string | null {
  return key ? `/api/photos/${encodeURIComponent(key)}` : null;
}
