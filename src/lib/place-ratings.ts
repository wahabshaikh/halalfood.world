import { sql } from "drizzle-orm";
import { database } from "../db";

export const PLACE_RATING_VALUES = [
  "mashallah",
  "alhamdulillah",
  "astaghfirullah",
] as const;

export type PlaceRating = (typeof PLACE_RATING_VALUES)[number];

export type PlaceRatingCounts = {
  mashallah: number;
  alhamdulillah: number;
  astaghfirullah: number;
  total: number;
};

export type PlaceRatingSnapshot = {
  counts: PlaceRatingCounts;
  currentRating: PlaceRating | null;
};

export type PlaceRatingValidationResult =
  | { ok: true; data: { rating: PlaceRating } }
  | { ok: false; error: string };

export type PlaceRatingMutationResult =
  | { ok: true; snapshot: PlaceRatingSnapshot }
  | { ok: false; reason: "not-found" };

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isPlaceRating(value: unknown): value is PlaceRating {
  return (
    typeof value === "string" &&
    (PLACE_RATING_VALUES as readonly string[]).includes(value)
  );
}

/** Validate the JSON contract used by PUT /api/places/:id/rating. */
export function validatePlaceRatingInput(
  body: unknown,
): PlaceRatingValidationResult {
  const input = objectValue(body);
  if (!input) return { ok: false, error: "Send a JSON object." };
  if (!isPlaceRating(input.rating))
    return {
      ok: false,
      error:
        "Choose a halal reaction: mashallah, alhamdulillah, or astaghfirullah.",
    };
  return { ok: true, data: { rating: input.rating } };
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function countValue(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

function mapSnapshot(row: Record<string, unknown>): PlaceRatingSnapshot {
  return {
    counts: {
      mashallah: countValue(row.mashallah),
      alhamdulillah: countValue(row.alhamdulillah),
      astaghfirullah: countValue(row.astaghfirullah),
      total: countValue(row.total),
    },
    currentRating: isPlaceRating(row.current_rating)
      ? row.current_rating
      : null,
  };
}

async function getSnapshot(
  client: DatabaseClient,
  placeId: string,
  userId: string | null,
): Promise<PlaceRatingSnapshot | null> {
  const currentRating = userId
    ? sql`MAX(r.rating) FILTER (WHERE r.user_id = ${userId})`
    : sql`NULL`;
  const rows = await client.all<Record<string, unknown>>(sql`
    SELECT
      COUNT(r.user_id) AS total,
      COUNT(r.user_id) FILTER (WHERE r.rating = 'mashallah') AS mashallah,
      COUNT(r.user_id) FILTER (WHERE r.rating = 'alhamdulillah') AS alhamdulillah,
      COUNT(r.user_id) FILTER (WHERE r.rating = 'astaghfirullah') AS astaghfirullah,
      ${currentRating} AS current_rating
    FROM places AS p
    LEFT JOIN place_ratings AS r ON r.place_id = p.id
    WHERE p.id = ${placeId}
      AND p.halal_confirmed = 1
    GROUP BY p.id
  `);
  const row = rows[0];
  return row ? mapSnapshot(row) : null;
}

export interface PlaceRatingRepository {
  get(placeId: string, userId: string | null): Promise<PlaceRatingSnapshot | null>;
  upsert(
    userId: string,
    placeId: string,
    rating: PlaceRating,
  ): Promise<PlaceRatingSnapshot | null>;
}

/** D1-backed rating operations. The caller owns auth and rate limits. */
export function d1PlaceRatingRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): PlaceRatingRepository {
  return {
    async get(placeId, userId) {
      const db = await client;
      return getSnapshot(db, placeId, userId);
    },

    async upsert(userId, placeId, rating) {
      const db = await client;
      const now = Date.now();
      const rows = await db.all<{ place_id: string }>(sql`
        INSERT INTO place_ratings (user_id, place_id, rating, created_at, updated_at)
        SELECT ${userId}, p.id, ${rating}, ${now}, ${now}
        FROM places AS p
        WHERE p.id = ${placeId}
          AND p.halal_confirmed = 1
        ON CONFLICT (user_id, place_id) DO UPDATE SET
          rating = excluded.rating,
          updated_at = excluded.updated_at
        RETURNING place_id
      `);
      if (!rows.length) return null;
      return getSnapshot(db, placeId, userId);
    },
  };
}

export async function ratePlaceForUser(
  repository: PlaceRatingRepository,
  userId: string,
  placeId: string,
  rating: PlaceRating,
): Promise<PlaceRatingMutationResult> {
  const snapshot = await repository.upsert(userId, placeId, rating);
  if (!snapshot) return { ok: false, reason: "not-found" };
  return { ok: true, snapshot };
}
