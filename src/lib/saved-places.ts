import { sql } from "drizzle-orm";
import { database } from "../db";
import type { Place } from "./places";

export const SAVED_PLACES_LIMIT = 200;

export type SavedPlace = Omit<Place, "lat" | "lng"> & {
  lat: number | null;
  lng: number | null;
  saved_at: string | Date | null;
};

export type SavedPlaceList = {
  places: SavedPlace[];
  total: number;
  limit: number;
};

export type SavedPlaceMutationResult =
  | { ok: true; saved: boolean }
  | { ok: false; reason: "not-found" };

/** Small repository boundary so save/unsave behavior can be unit-tested. */
export interface SavedPlaceRepository {
  hasPlace(placeId: string): Promise<boolean>;
  add(userId: string, placeId: string): Promise<void>;
  remove(userId: string, placeId: string): Promise<void>;
  list(userId: string): Promise<SavedPlaceList>;
}

type DatabaseClient = ReturnType<typeof database>;

/** Neon-backed saved-place operations. The caller owns auth and rate limits. */
export function neonSavedPlaceRepository(
  client: DatabaseClient = database(),
): SavedPlaceRepository {
  return {
    async hasPlace(placeId) {
      const result = await client.execute(sql`
        SELECT 1
        FROM places
        WHERE id = ${placeId}::uuid AND halal_confirmed IS TRUE
        LIMIT 1
      `);
      return result.rows.length > 0;
    },

    async add(userId, placeId) {
      await client.execute(sql`
        INSERT INTO saved_places (user_id, place_id)
        VALUES (${userId}, ${placeId}::uuid)
        ON CONFLICT (user_id, place_id) DO NOTHING
      `);
    },

    async remove(userId, placeId) {
      await client.execute(sql`
        DELETE FROM saved_places
        WHERE user_id = ${userId} AND place_id = ${placeId}::uuid
      `);
    },

    async list(userId) {
      const result = await client.execute(sql`
        SELECT
          p.id::text AS id,
          p.name,
          p.city_slug,
          p.street_address,
          p.address_locality,
          p.address_country,
          p.telephone,
          p.website,
          p.rating_value,
          p.review_count,
          p.lat,
          p.lng,
          saved.created_at AS saved_at,
          count(*) OVER()::integer AS total
        FROM saved_places AS saved
        INNER JOIN places AS p ON p.id = saved.place_id
        WHERE saved.user_id = ${userId}
          AND p.halal_confirmed IS TRUE
        ORDER BY saved.created_at DESC, p.name, p.id
        LIMIT ${SAVED_PLACES_LIMIT}
      `);
      const rows = result.rows as unknown as (SavedPlace & { total: number })[];
      return {
        places: rows.map(({ total: _total, ...place }) => place),
        total: rows[0]?.total ?? 0,
        limit: SAVED_PLACES_LIMIT,
      };
    },
  };
}

export async function savePlaceForUser(
  repository: SavedPlaceRepository,
  userId: string,
  placeId: string,
): Promise<SavedPlaceMutationResult> {
  if (!(await repository.hasPlace(placeId)))
    return { ok: false, reason: "not-found" };
  await repository.add(userId, placeId);
  return { ok: true, saved: true };
}

export async function unsavePlaceForUser(
  repository: SavedPlaceRepository,
  userId: string,
  placeId: string,
): Promise<SavedPlaceMutationResult> {
  if (!(await repository.hasPlace(placeId)))
    return { ok: false, reason: "not-found" };
  await repository.remove(userId, placeId);
  return { ok: true, saved: false };
}
