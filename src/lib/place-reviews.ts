import { sql } from "drizzle-orm";
import { database } from "../db";

export const PLACE_REVIEW_TITLE_MAX_LENGTH = 120;
export const PLACE_REVIEW_BODY_MAX_LENGTH = 5000;
// Four-byte UTF-8 characters at the body limit plus JSON framing still fit.
export const PLACE_REVIEW_MAX_PAYLOAD_BYTES = 32 * 1024;

export type PlaceReviewInput = {
  title: string | null;
  body: string;
};

export type PlaceReview = {
  authorDisplayName: string;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  isOwn: boolean;
};

export type PlaceReviewValidationResult =
  | { ok: true; data: PlaceReviewInput }
  | { ok: false; error: string };

export type PlaceReviewMutationResult =
  | { ok: true }
  | { ok: false; reason: "not-found" };

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

/** Validate and normalize the JSON contract used by review mutations. */
export function validatePlaceReviewInput(
  body: unknown,
): PlaceReviewValidationResult {
  const input = objectValue(body);
  if (!input) return { ok: false, error: "Send a JSON object." };

  if (typeof input.body !== "string")
    return { ok: false, error: "Review body is required." };
  const reviewBody = input.body.trim();
  if (!reviewBody) return { ok: false, error: "Review body is required." };
  if (characterLength(reviewBody) > PLACE_REVIEW_BODY_MAX_LENGTH)
    return {
      ok: false,
      error: `Review body must be ${PLACE_REVIEW_BODY_MAX_LENGTH} characters or fewer.`,
    };

  let title: string | null = null;
  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== "string")
      return { ok: false, error: "Review title must be text." };
    title = input.title.trim() || null;
    if (title && characterLength(title) > PLACE_REVIEW_TITLE_MAX_LENGTH)
      return {
        ok: false,
        error: `Review title must be ${PLACE_REVIEW_TITLE_MAX_LENGTH} characters or fewer.`,
      };
  }

  return { ok: true, data: { title, body: reviewBody } };
}

export interface PlaceReviewRepository {
  hasPlace(placeId: string): Promise<boolean>;
  list(placeId: string, userId: string | null): Promise<PlaceReview[]>;
  upsert(
    userId: string,
    placeId: string,
    input: PlaceReviewInput,
  ): Promise<boolean>;
  delete(userId: string, placeId: string): Promise<boolean>;
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function mapReview(row: Record<string, unknown>): PlaceReview {
  const author =
    typeof row.author_display_name === "string" && row.author_display_name.trim()
      ? row.author_display_name.trim()
      : "Halalfood member";
  return {
    authorDisplayName: author,
    title: typeof row.title === "string" && row.title.trim() ? row.title : null,
    body: typeof row.body === "string" ? row.body : "",
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    isOwn: row.is_own === true || row.is_own === 1 || row.is_own === "true",
  };
}

function isOwnReviewRow(row: Record<string, unknown>): boolean {
  return row.is_own === true || row.is_own === 1 || row.is_own === "true";
}

/** D1-backed review operations. The caller owns auth and rate limits. */
export function d1PlaceReviewRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): PlaceReviewRepository {
  return {
    async hasPlace(placeId) {
      const db = await client;
      const rows = await db.all(sql`
        SELECT 1
        FROM places
        WHERE id = ${placeId} AND halal_confirmed = 1
        LIMIT 1
      `);
      return rows.length > 0;
    },

    async list(placeId, userId) {
      const db = await client;
      const ownReview = userId ? sql`r.user_id = ${userId}` : sql`0`;
      const rows = await db.all<Record<string, unknown>>(sql`
        SELECT
          COALESCE(
            NULLIF(TRIM(u.name), ''),
            NULLIF(TRIM(u.email), ''),
            'Halalfood member'
          ) AS author_display_name,
          r.title,
          r.body,
          r.created_at,
          r.updated_at,
          ${ownReview} AS is_own
        FROM place_reviews AS r
        INNER JOIN places AS p ON p.id = r.place_id
        INNER JOIN "user" AS u ON u.id = r.user_id
        WHERE r.place_id = ${placeId}
          AND p.halal_confirmed = 1
        ORDER BY r.created_at DESC, r.updated_at DESC, r.user_id
        LIMIT 50
      `);
      if (userId && !rows.some(isOwnReviewRow)) {
        const ownRows = await db.all<Record<string, unknown>>(sql`
          SELECT
            COALESCE(
              NULLIF(TRIM(u.name), ''),
              NULLIF(TRIM(u.email), ''),
              'Halalfood member'
            ) AS author_display_name,
            r.title,
            r.body,
            r.created_at,
            r.updated_at,
            1 AS is_own
          FROM place_reviews AS r
          INNER JOIN places AS p ON p.id = r.place_id
          INNER JOIN "user" AS u ON u.id = r.user_id
          WHERE r.place_id = ${placeId}
            AND r.user_id = ${userId}
            AND p.halal_confirmed = 1
          LIMIT 1
        `);
        rows.push(...ownRows);
      }
      return rows.map(mapReview);
    },

    async upsert(userId, placeId, input) {
      const db = await client;
      const now = Date.now();
      const rows = await db.all<{ place_id: string }>(sql`
        INSERT INTO place_reviews (
          user_id, place_id, title, body, created_at, updated_at
        )
        SELECT
          ${userId}, p.id, ${input.title}, ${input.body}, ${now}, ${now}
        FROM places AS p
        WHERE p.id = ${placeId}
          AND p.halal_confirmed = 1
        ON CONFLICT (user_id, place_id) DO UPDATE SET
          title = excluded.title,
          body = excluded.body,
          updated_at = excluded.updated_at
        RETURNING place_id
      `);
      return rows.length > 0;
    },

    async delete(userId, placeId) {
      const db = await client;
      const rows = await db.all<{ place_id: string }>(sql`
        DELETE FROM place_reviews
        WHERE user_id = ${userId}
          AND place_id = ${placeId}
          AND EXISTS (
            SELECT 1 FROM places
            WHERE places.id = place_reviews.place_id AND places.halal_confirmed = 1
          )
        RETURNING place_id
      `);
      return rows.length > 0;
    },
  };
}

export async function savePlaceReviewForUser(
  repository: PlaceReviewRepository,
  userId: string,
  placeId: string,
  input: PlaceReviewInput,
): Promise<PlaceReviewMutationResult> {
  if (!(await repository.upsert(userId, placeId, input)))
    return { ok: false, reason: "not-found" };
  return { ok: true };
}

export async function deletePlaceReviewForUser(
  repository: PlaceReviewRepository,
  userId: string,
  placeId: string,
): Promise<PlaceReviewMutationResult> {
  if (!(await repository.delete(userId, placeId)))
    return { ok: false, reason: "not-found" };
  return { ok: true };
}
