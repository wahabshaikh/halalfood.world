import { sql } from "drizzle-orm";
import { database } from "../db";
import type { PlacePhotoContentType } from "./r2";

export type PlacePhoto = {
  id: string;
  r2Key: string;
  contentType: PlacePhotoContentType;
  byteSize: number;
  fileName: string;
  createdAt: string;
  isOwn: boolean;
};

export type PlacePhotoCreateInput = {
  r2Key: string;
  contentType: PlacePhotoContentType;
  byteSize: number;
  fileName: string;
};

export type PlacePhotoAccess = {
  contentType: PlacePhotoContentType;
  fileName: string;
};

export interface PlacePhotoRepository {
  hasPlace(placeId: string): Promise<boolean>;
  list(placeId: string, userId: string | null): Promise<PlacePhoto[]>;
  create(
    userId: string,
    placeId: string,
    input: PlacePhotoCreateInput,
  ): Promise<PlacePhoto | null>;
  deleteOwn(
    userId: string,
    placeId: string,
    photoId: string,
  ): Promise<{ r2Key: string } | null>;
  getUploadAccess(key: string): Promise<PlacePhotoAccess | null>;
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function contentType(value: unknown): PlacePhotoContentType {
  if (value === "image/png") return "image/png";
  if (value === "image/webp") return "image/webp";
  return "image/jpeg";
}

function extensionFor(content: PlacePhotoContentType): "jpg" | "png" | "webp" {
  return content === "image/jpeg" ? "jpg" : content === "image/png" ? "png" : "webp";
}

function mapPhoto(row: Record<string, unknown>): PlacePhoto {
  const type = contentType(row.content_type);
  const rawFileName =
    typeof row.original_file_name === "string" ? row.original_file_name.trim() : "";
  const byteSize = Number(row.byte_size);
  return {
    id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
    r2Key: typeof row.r2_key === "string" ? row.r2_key : "",
    contentType: type,
    byteSize: Number.isInteger(byteSize) && byteSize > 0 ? byteSize : 0,
    fileName: rawFileName || `halal-photo.${extensionFor(type)}`,
    createdAt: isoDate(row.created_at),
    isOwn: row.is_own === true || row.is_own === 1 || row.is_own === "true",
  };
}

function photoFromRow(row: Record<string, unknown> | undefined): PlacePhoto | null {
  if (!row || typeof row.r2_key !== "string" || !row.r2_key) return null;
  const photo = mapPhoto(row);
  return photo.id ? photo : null;
}

/** D1-backed place photo operations. Callers own auth, limits, and R2 I/O. */
export function d1PlacePhotoRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): PlacePhotoRepository {
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
      const ownPhoto = userId ? sql`ph.user_id = ${userId}` : sql`0`;
      const rows = await db.all<Record<string, unknown>>(sql`
        SELECT
          ph.id AS id,
          ph.r2_key,
          ph.content_type,
          ph.byte_size,
          ph.original_file_name,
          ph.created_at,
          ${ownPhoto} AS is_own
        FROM place_photos AS ph
        INNER JOIN places AS p ON p.id = ph.place_id
        WHERE ph.place_id = ${placeId}
          AND p.halal_confirmed = 1
        ORDER BY ph.created_at DESC, ph.id DESC
        LIMIT 100
      `);
      return rows.map(mapPhoto);
    },

    async create(userId, placeId, input) {
      const db = await client;
      const id = crypto.randomUUID();
      const rows = await db.all<Record<string, unknown>>(sql`
        INSERT INTO place_photos (
          id, place_id, user_id, r2_key, content_type, byte_size,
          original_file_name, created_at
        )
        SELECT
          ${id},
          p.id,
          ${userId},
          ${input.r2Key},
          ${input.contentType},
          ${input.byteSize},
          ${input.fileName},
          ${Date.now()}
        FROM places AS p
        WHERE p.id = ${placeId}
          AND p.halal_confirmed = 1
        RETURNING
          id, r2_key, content_type, byte_size,
          original_file_name, created_at, 1 AS is_own
      `);
      return photoFromRow(rows[0]);
    },

    async deleteOwn(userId, placeId, photoId) {
      const db = await client;
      const rows = await db.all<{ r2_key?: unknown }>(sql`
        DELETE FROM place_photos
        WHERE id = ${photoId}
          AND place_id = ${placeId}
          AND user_id = ${userId}
          AND EXISTS (
            SELECT 1 FROM places
            WHERE places.id = place_photos.place_id AND places.halal_confirmed = 1
          )
        RETURNING r2_key
      `);
      const row = rows[0];
      return typeof row?.r2_key === "string" ? { r2Key: row.r2_key } : null;
    },

    async getUploadAccess(key) {
      const db = await client;
      const rows = await db.all<{ content_type?: unknown; original_file_name?: unknown }>(sql`
        SELECT ph.content_type, ph.original_file_name
        FROM place_photos AS ph
        INNER JOIN places AS p ON p.id = ph.place_id
        WHERE ph.r2_key = ${key}
          AND p.halal_confirmed = 1
        LIMIT 1
      `);
      const row = rows[0];
      if (
        !row ||
        (row.content_type !== "image/jpeg" &&
          row.content_type !== "image/png" &&
          row.content_type !== "image/webp") ||
        typeof row.original_file_name !== "string"
      )
        return null;
      return {
        contentType: row.content_type,
        fileName: row.original_file_name,
      };
    },
  };
}

export type PlacePhotoMutationResult =
  | { ok: true; photo: PlacePhoto }
  | { ok: false; reason: "not-found" };

export async function registerPlacePhotoForUser(
  repository: PlacePhotoRepository,
  userId: string,
  placeId: string,
  input: PlacePhotoCreateInput,
): Promise<PlacePhotoMutationResult> {
  if (!(await repository.hasPlace(placeId)))
    return { ok: false, reason: "not-found" };
  const photo = await repository.create(userId, placeId, input);
  return photo ? { ok: true, photo } : { ok: false, reason: "not-found" };
}

export type PlacePhotoDeleteResult =
  | { ok: true; r2Key: string }
  | { ok: false; reason: "not-found" };

export async function deletePlacePhotoForUser(
  repository: PlacePhotoRepository,
  userId: string,
  placeId: string,
  photoId: string,
): Promise<PlacePhotoDeleteResult> {
  const deleted = await repository.deleteOwn(userId, placeId, photoId);
  return deleted
    ? { ok: true, r2Key: deleted.r2Key }
    : { ok: false, reason: "not-found" };
}
