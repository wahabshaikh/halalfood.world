import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import { LISTED, PLACE_CARD_COLUMNS, toPlaceCard, type PlaceCard } from "./place-view";

export const SAVED_PLACES_LIMIT = 200;

export type SavedPlace = PlaceCard & { savedAt: number };

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
  savedIds(userId: string, placeIds: string[]): Promise<Set<string>>;
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/** D1-backed saved-place operations. The caller owns auth and rate limits. */
export function d1SavedPlaceRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): SavedPlaceRepository {
  return {
    async hasPlace(placeId) {
      const db = await client;
      const rows = await db.all(sql`
        SELECT 1
        FROM places
        WHERE id = ${placeId} AND listing_status = 'listed'
        LIMIT 1
      `);
      return rows.length > 0;
    },

    async add(userId, placeId) {
      const db = await client;
      await db.run(sql`
        INSERT INTO saved_places (user_id, place_id, created_at)
        VALUES (${userId}, ${placeId}, ${Date.now()})
        ON CONFLICT (user_id, place_id) DO NOTHING
      `);
    },

    async remove(userId, placeId) {
      const db = await client;
      await db.run(sql`
        DELETE FROM saved_places
        WHERE user_id = ${userId} AND place_id = ${placeId}
      `);
    },

    async list(userId) {
      const db = await client;
      const rows = await db.all<Record<string, unknown>>(sql`
        SELECT ${PLACE_CARD_COLUMNS}, saved.created_at AS saved_at, count(*) OVER() AS total
        FROM saved_places AS saved
        JOIN places p ON p.id = saved.place_id
        JOIN place_status s ON s.place_id = p.id
        WHERE saved.user_id = ${userId} AND ${LISTED}
        ORDER BY saved.created_at DESC, p.name, p.id
        LIMIT ${SAVED_PLACES_LIMIT}
      `);
      return {
        places: rows.map((row) => ({ ...toPlaceCard(row), savedAt: Number(row.saved_at) })),
        total: Number(rows[0]?.total ?? 0),
        limit: SAVED_PLACES_LIMIT,
      };
    },

    async savedIds(userId, placeIds) {
      if (!placeIds.length) return new Set<string>();
      const db = await client;
      const rows = await db.all<{ place_id: string }>(sql`
        SELECT place_id FROM saved_places
        WHERE user_id = ${userId} AND place_id IN (${sql.join(placeIds.map((id) => sql`${id}`), sql`, `)})
      `);
      return new Set(rows.map((row) => row.place_id));
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
