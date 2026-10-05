import { sql, type SQL } from "drizzle-orm";
import { citySlugParam } from "@halalfood/core/params";
import { parseFilters, type Filter } from "@halalfood/core/halal";
import { database } from "../db";
import { listingCachedRead } from "./listing-cache";
import { loadOrDegrade, type Loaded } from "./load";
import { containsText, normalizeSearchQuery } from "./text-search";
import {
  LISTED,
  PLACE_CARD_COLUMNS,
  PLACE_CARD_FROM,
  distanceKmSql,
  filterConditions,
  toPlaceCard,
  type PlaceCard,
} from "./place-view";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type { PlaceCard };

/** Everything a place page renders besides checks, photos and social. */
export type PlaceDetail = {
  id: string;
  name: string;
  city_slug: string;
  street_address: string;
  address_locality: string | null;
  address_region: string | null;
  postal_code: string | null;
  address_country: string | null;
  telephone: string | null;
  website: string | null;
  maps_url: string | null;
  google_place_id: string | null;
  serves_cuisine: string[];
  lat: number | null;
  lng: number | null;
  google_details_snapshot: string | null;
  google_details_cached_at: number | null;
  updated_at: number;
  card: PlaceCard;
  verified_at: number | null;
  last_checked_at: number | null;
};

export type City = {
  city_slug: string;
  place_count: number;
  address_country: string | null;
  center_lat: number | null;
  center_lng: number | null;
};

const DIRECTORY_TTL_SECONDS = 60 * 60;
const CITY_TTL_SECONDS = 10 * 60;
const SITEMAP_TTL_SECONDS = 6 * 60 * 60;
const MAX_CITIES = 2000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(Math.trunc(value) || min, min), max);

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** One listed place, joined to its status. The id must already have passed `placeIdParam`. */
export async function getPlaceById(id: string, client: Client = database()): Promise<PlaceDetail | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${PLACE_CARD_COLUMNS}, p.address_region, p.postal_code, p.address_country,
      p.telephone, p.website, p.maps_url, p.google_place_id, p.google_details_snapshot,
      p.google_details_cached_at, p.updated_at, s.verified_at, s.last_checked_at
    FROM ${PLACE_CARD_FROM}
    WHERE p.id = ${id} AND ${LISTED}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const card = toPlaceCard(row);
  return {
    id: card.id,
    name: card.name,
    city_slug: card.citySlug,
    street_address: String(row.street_address),
    address_locality: (row.address_locality as string | null) ?? null,
    address_region: (row.address_region as string | null) ?? null,
    postal_code: (row.postal_code as string | null) ?? null,
    address_country: (row.address_country as string | null) ?? null,
    telephone: (row.telephone as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    maps_url: (row.maps_url as string | null) ?? null,
    google_place_id: (row.google_place_id as string | null) ?? null,
    serves_cuisine: (() => {
      try {
        const parsed = JSON.parse(String(row.serves_cuisine ?? "[]"));
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    })(),
    lat: card.lat,
    lng: card.lng,
    google_details_snapshot: (row.google_details_snapshot as string | null) ?? null,
    google_details_cached_at: num(row.google_details_cached_at),
    updated_at: num(row.updated_at) ?? 0,
    card,
    verified_at: num(row.verified_at),
    last_checked_at: num(row.last_checked_at),
  };
}

export type CreatePlaceInput = {
  name: string;
  citySlug: string;
  streetAddress: string;
  addressLocality: string | null;
  addressCountry: string | null;
  mapsUrl: string | null;
  googlePlaceId: string | null;
  servesCuisine: string[];
  lat: number | null;
  lng: number | null;
  submittedByUserId: string;
};

/** Statements that list a new place and its unchecked status row. */
export function createPlaceStatements(input: CreatePlaceInput, id: string, now: number): SQL[] {
  return [
    sql`INSERT INTO places (
      id, name, city_slug, street_address, address_locality, address_country, maps_url,
      google_place_id, serves_cuisine, lat, lng, submitted_by_user_id, listing_status,
      created_at, updated_at
    ) VALUES (
      ${id}, ${input.name}, ${input.citySlug}, ${input.streetAddress}, ${input.addressLocality},
      ${input.addressCountry}, ${input.mapsUrl}, ${input.googlePlaceId},
      ${JSON.stringify(input.servesCuisine)}, ${input.lat}, ${input.lng},
      ${input.submittedByUserId}, 'listed', ${now}, ${now}
    )`,
    sql`INSERT INTO place_status (place_id, status, progress, eligible_checks, updated_at)
      VALUES (${id}, 'unchecked', 0, 0, ${now})`,
  ];
}

/** A listed place with this Google id, if any. Hidden and closed places count too. */
export async function findPlaceByGoogleId(
  googlePlaceId: string,
  client: Client = database(),
): Promise<{ id: string; listing_status: string } | null> {
  const db = await client;
  const rows = await db.all<{ id: string; listing_status: string }>(sql`
    SELECT id, listing_status FROM places WHERE google_place_id = ${googlePlaceId} LIMIT 1
  `);
  return rows[0] ?? null;
}

/** Which of these Google ids are already places. */
export async function listedGoogleIds(ids: string[], client: Client = database()): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const db = await client;
  const rows = await db.all<{ id: string; google_place_id: string }>(sql`
    SELECT id, google_place_id FROM places
    WHERE google_place_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  return new Map(rows.map((row) => [row.google_place_id, row.id]));
}

/* ------------------------------------------------------------------------ */
/* Explore and map                                                           */
/* ------------------------------------------------------------------------ */

export type ExploreQuery = {
  citySlug?: string | null;
  bbox?: { west: number; south: number; east: number; north: number } | null;
  near?: { lat: number; lng: number } | null;
  filters?: readonly Filter[];
  /** Only places these people have shared a check at or saved. */
  friendIds?: readonly string[] | null;
  limit?: number;
  offset?: number;
};

export async function explorePlaces(
  query: ExploreQuery,
  client: Client = database(),
): Promise<{ places: PlaceCard[]; total: number }> {
  const limit = clamp(query.limit ?? 30, 1, 300);
  const offset = clamp(query.offset ?? 0, 0, 100000);
  const conditions: SQL[] = [LISTED, ...filterConditions(query.filters ?? [])];
  if (query.citySlug) conditions.push(sql`p.city_slug = ${query.citySlug}`);
  if (query.bbox) {
    const { west, south, east, north } = query.bbox;
    conditions.push(sql`p.lat IS NOT NULL AND p.lng IS NOT NULL AND p.lat BETWEEN ${south} AND ${north}`);
    conditions.push(west <= east ? sql`p.lng BETWEEN ${west} AND ${east}` : sql`(p.lng >= ${west} OR p.lng <= ${east})`);
  }
  if (query.friendIds) {
    if (!query.friendIds.length) return { places: [], total: 0 };
    const ids = sql.join(query.friendIds.map((id) => sql`${id}`), sql`, `);
    // check-visibility: audience — shared checks and saves by people the viewer follows.
    conditions.push(sql`(
      EXISTS (SELECT 1 FROM checks c WHERE c.place_id = p.id AND c.shared = 1 AND c.user_id IN (${ids}))
      OR EXISTS (SELECT 1 FROM saved_places sp WHERE sp.place_id = p.id AND sp.user_id IN (${ids}))
    )`);
  }
  const distance = query.near ? distanceKmSql(query.near.lat, query.near.lng) : null;
  const order = distance
    ? sql`CASE WHEN p.lat IS NULL THEN 1 ELSE 0 END, distance_km, p.id`
    : sql`CASE s.status WHEN 'verified' THEN 0 WHEN 'checking' THEN 1 ELSE 2 END, s.progress DESC, s.last_checked_at DESC, p.name, p.id`;
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${PLACE_CARD_COLUMNS}, ${distance ?? sql`NULL`} AS distance_km, count(*) OVER() AS total
    FROM ${PLACE_CARD_FROM}
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${order}
    LIMIT ${limit} OFFSET ${offset}
  `);
  return { places: rows.map(toPlaceCard), total: num(rows[0]?.total) ?? 0 };
}

/** Places within `radiusKm`, nearest first. */
export async function nearbyPlaces(
  origin: { lat: number; lng: number },
  options: { excludeId?: string; limit?: number; radiusKm?: number } = {},
  client: Client = database(),
): Promise<PlaceCard[]> {
  const radius = options.radiusKm ?? 10;
  // A degree of latitude is ~111 km; the box keeps the scan on the lat/lng index.
  const dLat = radius / 111;
  const dLng = radius / (111 * Math.max(0.1, Math.cos((origin.lat * Math.PI) / 180)));
  const result = await explorePlaces(
    {
      bbox: { west: origin.lng - dLng, east: origin.lng + dLng, south: origin.lat - dLat, north: origin.lat + dLat },
      near: origin,
      limit: (options.limit ?? 4) + 1,
    },
    client,
  );
  return result.places.filter((place) => place.id !== options.excludeId).slice(0, options.limit ?? 4);
}

export function parseExploreFilters(value: string | null | undefined): Filter[] {
  return parseFilters(value);
}

/* ------------------------------------------------------------------------ */
/* Search                                                                    */
/* ------------------------------------------------------------------------ */

export async function searchPlaces(
  rawQuery: string,
  options: { limit?: number; citySlug?: string | null } = {},
  client: Client = database(),
): Promise<PlaceCard[]> {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) return [];
  const limit = clamp(options.limit ?? 5, 1, 50);
  const conditions: SQL[] = [
    LISTED,
    sql`(${sql.join(
      [
        containsText(sql`p.name`, q),
        containsText(sql`p.serves_cuisine`, q),
        containsText(sql`p.address_locality`, q),
        containsText(sql`p.street_address`, q),
        // check-visibility: aggregate — matches on dish names only, no author is exposed.
        sql`EXISTS (SELECT 1 FROM checks c JOIN check_dishes d ON d.check_id = c.id
          WHERE c.place_id = p.id AND c.excluded = 0 AND ${containsText(sql`d.name`, q)})`,
      ],
      sql` OR `,
    )})`,
  ];
  // Places in the current city come first, then everywhere else.
  const cityFirst = options.citySlug ? sql`CASE WHEN p.city_slug = ${options.citySlug} THEN 0 ELSE 1 END,` : sql``;
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${PLACE_CARD_COLUMNS}
    FROM ${PLACE_CARD_FROM}
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${cityFirst} CASE WHEN ${containsText(sql`p.name`, q)} THEN 0 ELSE 1 END,
      CASE s.status WHEN 'verified' THEN 0 WHEN 'checking' THEN 1 ELSE 2 END, p.name, p.id
    LIMIT ${limit}
  `);
  return rows.map(toPlaceCard);
}

/* ------------------------------------------------------------------------ */
/* Cities                                                                    */
/* ------------------------------------------------------------------------ */

async function queryCities(client: Client, limit: number, offset: number, citySlug?: string) {
  const db = await client;
  return db.all<City>(sql`
    SELECT p.city_slug, count(*) AS place_count, min(p.address_country) AS address_country,
      avg(p.lat) AS center_lat, avg(p.lng) AS center_lng
    FROM places p
    WHERE ${LISTED} ${citySlug ? sql`AND p.city_slug = ${citySlug}` : sql``}
    GROUP BY p.city_slug
    ORDER BY count(*) DESC, p.city_slug
    LIMIT ${limit} OFFSET ${offset}
  `);
}

/** Every city, largest first. Grouping is a full scan, so the directory is cached. */
export async function listCities(options: { limit?: number; offset?: number } = {}, client?: Client) {
  const limit = clamp(options.limit ?? 500, 1, MAX_CITIES);
  const offset = clamp(options.offset ?? 0, 0, 100000);
  if (client) return queryCities(client, limit, offset);
  const all = await listingCachedRead("cities:v3", DIRECTORY_TTL_SECONDS, () =>
    queryCities(database(), MAX_CITIES, 0),
  );
  return all.slice(offset, offset + limit);
}

export async function searchCities(rawQuery: string, limit = 5, client?: Client): Promise<City[]> {
  const q = normalizeSearchQuery(rawQuery).toLowerCase();
  if (!q) return [];
  const all = await listCities({ limit: MAX_CITIES }, client);
  return all.filter((city) => city.city_slug.replace(/-/g, " ").includes(q)).slice(0, limit);
}

export async function getCity(citySlug: string, client?: Client): Promise<City | null> {
  if (client) return (await queryCities(client, 1, 0, citySlug))[0] ?? null;
  return listingCachedRead(`city:v3:${citySlug}`, CITY_TTL_SECONDS, async () =>
    (await queryCities(database(), 1, 0, citySlug))[0] ?? null,
  );
}

/** An unknown slug is `missing` (404); a failed read is `error`. */
export async function loadCityRecord(rawSlug: string, client?: Client): Promise<Loaded<City>> {
  const slug = citySlugParam(rawSlug);
  if (!slug) return { status: "missing" };
  return loadOrDegrade(() => getCity(slug, client));
}

/** The city nearest a point, for "Use my location" and first visits. */
export async function nearestCity(point: { lat: number; lng: number }, client?: Client): Promise<City | null> {
  const cities = await listCities({ limit: MAX_CITIES }, client);
  let best: City | null = null;
  let bestDistance = Infinity;
  for (const city of cities) {
    if (city.center_lat === null || city.center_lng === null) continue;
    const dLat = city.center_lat - point.lat;
    const dLng = (city.center_lng - point.lng) * Math.cos((point.lat * Math.PI) / 180);
    const distance = dLat * dLat + dLng * dLng;
    if (distance < bestDistance) {
      best = city;
      bestDistance = distance;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/* Sitemaps and ops                                                          */
/* ------------------------------------------------------------------------ */

export async function countPlaces(): Promise<number> {
  return listingCachedRead("places:count:v3", DIRECTORY_TTL_SECONDS, async () => {
    const db = await database();
    const rows = await db.all<{ total: number }>(sql`SELECT count(*) AS total FROM places p WHERE ${LISTED}`);
    return rows[0]?.total ?? 0;
  });
}

export async function listPlaceRefs(options: { limit: number; offset: number }) {
  const limit = clamp(options.limit, 1, 25000);
  const offset = clamp(options.offset, 0, 1000000);
  return listingCachedRead(`places:sitemap:v3:${limit}:${offset}`, SITEMAP_TTL_SECONDS, async () => {
    const db = await database();
    return db.all<{ id: string; updated_at: number | null }>(sql`
      SELECT p.id, p.updated_at FROM places p WHERE ${LISTED}
      ORDER BY p.id LIMIT ${limit} OFFSET ${offset}
    `);
  });
}

export type PlaceCoordinateCandidate = {
  id: string;
  google_place_id: string;
  lat: number | null;
  lng: number | null;
};

/** Listed places with a Google id and no pin, for the coordinate backfill. */
export async function listPlacesNeedingCoordinateBackfill(
  options: { limit?: number } = {},
): Promise<PlaceCoordinateCandidate[]> {
  const limit = clamp(options.limit ?? 100, 1, 10000);
  const db = await database();
  return db.all<PlaceCoordinateCandidate>(sql`
    SELECT p.id, p.google_place_id, p.lat, p.lng FROM places p
    WHERE ${LISTED} AND p.google_place_id IS NOT NULL AND (p.lat IS NULL OR p.lng IS NULL)
    ORDER BY p.id LIMIT ${limit}
  `);
}

/** Set a pin only where one is still missing, so a re-run never overwrites. */
export async function updatePlaceCoordinatesIfMissing(
  id: string,
  googlePlaceId: string,
  coordinates: { lat: number; lng: number },
) {
  const { lat, lng } = coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  const db = await database();
  const rows = await db.all<{ id: string }>(sql`
    UPDATE places SET lat = ${lat}, lng = ${lng}, updated_at = ${Date.now()}
    WHERE id = ${id} AND google_place_id = ${googlePlaceId} AND listing_status = 'listed'
      AND (lat IS NULL OR lng IS NULL)
    RETURNING id
  `);
  return rows.length > 0;
}
