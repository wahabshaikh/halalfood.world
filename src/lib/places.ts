import { sql } from "drizzle-orm";
import { database } from "../db";

import { bboxParam } from "./params";

export type Place = {
  id: string;
  name: string;
  city_slug: string;
  street_address: string;
  address_locality: string | null;
  address_country: string | null;
  telephone: string | null;
  website: string | null;
  rating_value: string | null;
  review_count: number | null;
  lat: number;
  lng: number;
};

/** The full row a place page renders. Coordinates may be missing. */
export type PlaceDetail = Omit<Place, "lat" | "lng"> & {
  address_region: string | null;
  postal_code: string | null;
  maps_url: string | null;
  google_place_id: string | null;
  serves_cuisine: string[] | null;
  source: string | null;
  source_url: string | null;
  scraped_at: string | number | Date | null;
  halal_confirmed: boolean | null;
  google_details_cached_at: string | number | Date | null;
  google_details_snapshot: string | null;
  lat: number | null;
  lng: number | null;
};

export type CreatePlaceInput = {
  name: string;
  citySlug: string;
  cityUrl: string;
  streetAddress: string;
  addressLocality: string;
  mapsUrl: string | null;
  googlePlaceId: string | null;
  sourceUrl: string;
  lat: number | null;
  lng: number | null;
  submittedByUserId: string;
  halalConfirmed: true;
};

export type City = {
  city_slug: string;
  place_count: number;
  address_country: string | null;
  /** Mean of the city's listed (approximate) coordinates — for map centring. */
  center_lat: number | null;
  center_lng: number | null;
};

/** Never let a caller ask for an unbounded slice of the table. */
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(Math.trunc(value) || min, min), max);

const COORDS_PRESENT = sql`halal_confirmed = 1 AND lat IS NOT NULL AND lng IS NOT NULL`;

/** `rating_value` is stored as text ("4.30") to preserve scraped formatting; ratings are 0-5 so a numeric cast orders correctly. */
const RATING_DESC = sql`CAST(rating_value AS REAL) DESC`;

function parseServesCuisine(value: unknown): string[] | null {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export async function findPlaces(options: {
  bbox?: ReturnType<typeof bboxParam>;
  q?: string;
  limit: number;
}) {
  const conditions = [COORDS_PRESENT];
  if (options.bbox) {
    const { west, south, east, north } = options.bbox;
    conditions.push(sql`lat BETWEEN ${south} AND ${north}`);
    conditions.push(
      west <= east
        ? sql`lng BETWEEN ${west} AND ${east}`
        : sql`(lng >= ${west} OR lng <= ${east})`,
    );
  }
  if (options.q) {
    const term = "%" + options.q.replace(/[\\%_]/g, "\\$&") + "%";
    conditions.push(
      sql`(name LIKE ${term} ESCAPE '\\' OR replace(city_slug, '-', ' ') LIKE ${term} ESCAPE '\\' OR street_address LIKE ${term} ESCAPE '\\' OR address_locality LIKE ${term} ESCAPE '\\')`,
    );
  }
  const db = await database();
  const rows = await db.all<Place & { total: number }>(sql`
    SELECT id, name, city_slug, street_address, address_locality, address_country,
      telephone, website, rating_value, review_count, lat, lng, count(*) OVER() AS total
    FROM places WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${RATING_DESC} NULLS LAST, review_count DESC NULLS LAST, id
    LIMIT ${options.limit}
  `);
  return {
    places: rows.map(({ total: _total, ...place }) => place),
    total: rows[0]?.total ?? 0,
    limit: options.limit,
  };
}

/** One place by id. The id must already have passed `placeIdParam`. */
export async function getPlaceById(id: string): Promise<PlaceDetail | null> {
  const db = await database();
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, name, city_slug, street_address, address_locality, address_region,
      postal_code, address_country, telephone, website, maps_url, google_place_id,
      serves_cuisine,
      rating_value, review_count, source, source_url, scraped_at,
      halal_confirmed, google_details_cached_at, google_details_snapshot,
      lat, lng
    FROM places WHERE id = ${id} AND halal_confirmed = 1 LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    ...(row as unknown as PlaceDetail),
    serves_cuisine: parseServesCuisine(row.serves_cuisine),
    halal_confirmed: toBoolean(row.halal_confirmed),
  };
}

/** Insert one authenticated, explicitly halal user submission. */
export async function createPlace(input: CreatePlaceInput) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const db = await database();
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO places (
      id, name, city_slug, city_url, list_position, street_address,
      address_locality, address_region, postal_code, address_country,
      telephone, website, maps_url, google_place_id, serves_cuisine,
      rating_value, review_count, source, source_url, scraped_at, created_at,
      lat, lng, submitted_by_user_id, halal_confirmed
    ) VALUES (
      ${id}, ${input.name}, ${input.citySlug}, ${input.cityUrl}, NULL,
      ${input.streetAddress}, ${input.addressLocality}, NULL, NULL, NULL,
      NULL, NULL, ${input.mapsUrl}, ${input.googlePlaceId}, ${JSON.stringify(["Halal"])},
      NULL, NULL, 'user-submitted', ${input.sourceUrl}, ${now},
      ${now}, ${input.lat}, ${input.lng},
      ${input.submittedByUserId}, 1
    )
    RETURNING id
  `);
  const row = rows[0];
  if (typeof row?.id !== "string" || !row.id)
    throw new Error("Created place id was missing");
  return { id: row.id };
}

export type PlaceCoordinateCandidate = {
  id: string;
  google_place_id: string;
  lat: number | null;
  lng: number | null;
};

/**
 * Candidates deliberately mean missing either coordinate. Existing non-null
 * values may be approximate, but without provenance this safe first pass does
 * not overwrite them. See the operational backfill notes in README.md.
 */
export async function listPlacesNeedingCoordinateBackfill(options: {
  limit?: number;
} = {}): Promise<PlaceCoordinateCandidate[]> {
  const limit = clamp(options.limit ?? 100, 1, 10000);
  const db = await database();
  return db.all<PlaceCoordinateCandidate>(sql`
    SELECT id, google_place_id, lat, lng
    FROM places
    WHERE halal_confirmed = 1
      AND google_place_id IS NOT NULL AND (lat IS NULL OR lng IS NULL)
    ORDER BY id
    LIMIT ${limit}
  `);
}

/**
 * Update only a still-missing candidate. Rechecking the predicate makes a
 * repeated or concurrent backfill safe and avoids overwriting existing pins.
 */
export async function updatePlaceCoordinatesIfMissing(
  id: string,
  googlePlaceId: string,
  coordinates: { lat: number; lng: number },
) {
  if (
    !Number.isFinite(coordinates.lat) ||
    !Number.isFinite(coordinates.lng) ||
    coordinates.lat < -90 ||
    coordinates.lat > 90 ||
    coordinates.lng < -180 ||
    coordinates.lng > 180
  ) {
    return false;
  }

  const db = await database();
  const rows = await db.all<{ id: string }>(sql`
    UPDATE places
    SET lat = ${coordinates.lat}, lng = ${coordinates.lng}
    WHERE id = ${id}
      AND google_place_id = ${googlePlaceId}
      AND halal_confirmed = 1
      AND (lat IS NULL OR lng IS NULL)
    RETURNING id
  `);
  return rows.length > 0;
}

/** Distinct cities, largest first, for the city index and city sitemap. */
export async function listCities(
  options: { limit?: number; offset?: number } = {},
) {
  const limit = clamp(options.limit ?? 500, 1, 2000);
  const offset = clamp(options.offset ?? 0, 0, 100000);
  const db = await database();
  return db.all<City>(sql`
    SELECT city_slug,
      count(*) AS place_count,
      min(address_country) AS address_country,
      avg(lat) AS center_lat,
      avg(lng) AS center_lng
    FROM places WHERE ${COORDS_PRESENT}
    GROUP BY city_slug
    ORDER BY count(*) DESC, city_slug
    LIMIT ${limit} OFFSET ${offset}
  `);
}

export async function countCities() {
  const db = await database();
  const rows = await db.all<{ total: number }>(sql`
    SELECT count(DISTINCT city_slug) AS total
    FROM places WHERE ${COORDS_PRESENT}
  `);
  return rows[0]?.total ?? 0;
}

/** Aggregate for one city, or `null` when the slug matches nothing. */
export async function getCity(citySlug: string): Promise<City | null> {
  const db = await database();
  const rows = await db.all<City>(sql`
    SELECT city_slug,
      count(*) AS place_count,
      min(address_country) AS address_country,
      avg(lat) AS center_lat,
      avg(lng) AS center_lng
    FROM places WHERE ${COORDS_PRESENT} AND city_slug = ${citySlug}
    GROUP BY city_slug
  `);
  return rows[0] ?? null;
}

/** Places in one city, best rated first, paginated and capped. */
export async function findPlacesByCity(
  citySlug: string,
  options: { limit?: number; offset?: number } = {},
) {
  const limit = clamp(options.limit ?? 60, 1, 200);
  const offset = clamp(options.offset ?? 0, 0, 100000);
  const db = await database();
  const rows = await db.all<Place & { total: number }>(sql`
    SELECT id, name, city_slug, street_address, address_locality, address_country,
      telephone, website, rating_value, review_count, lat, lng,
      count(*) OVER() AS total
    FROM places WHERE ${COORDS_PRESENT} AND city_slug = ${citySlug}
    ORDER BY ${RATING_DESC} NULLS LAST, review_count DESC NULLS LAST, id
    LIMIT ${limit} OFFSET ${offset}
  `);
  return {
    places: rows.map(({ total: _total, ...place }) => place),
    total: rows[0]?.total ?? 0,
    limit,
    offset,
  };
}

export async function countPlaces() {
  const db = await database();
  const rows = await db.all<{ total: number }>(sql`
    SELECT count(*) AS total FROM places WHERE ${COORDS_PRESENT}
  `);
  return rows[0]?.total ?? 0;
}

/**
 * Ordered id slice for the chunked place sitemaps. Ordering by id keeps the
 * chunk boundaries stable between requests.
 */
export async function listPlaceRefs(options: { limit: number; offset: number }) {
  const limit = clamp(options.limit, 1, 25000);
  const offset = clamp(options.offset, 0, 1000000);
  const db = await database();
  return db.all<{ id: string; scraped_at: number | null }>(sql`
    SELECT id, scraped_at FROM places WHERE ${COORDS_PRESENT}
    ORDER BY id LIMIT ${limit} OFFSET ${offset}
  `);
}
