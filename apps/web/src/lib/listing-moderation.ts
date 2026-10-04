/**
 * Moderator controls on a listed place: unpublish, restore and set the pin.
 *
 * Unpublish is a hide, never a delete. The row keeps every visit, check and
 * photo, and `listing_status` goes from `listed` to `hidden`, the same flag
 * migrations 0020 and 0022 use.
 *
 * Restore only reverses a moderator's own unpublish. A place is restorable
 * when its latest unpublish or restore audit entry is an unpublish. Rows that
 * 0020 or 0022 hid (alcohol-led venues) never got that entry, so no control
 * here can list them again. The same holds for `halal_confirmed = 0` rows.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import { writeAudit } from "./contributions-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export const UNPUBLISH_ACTION = "place.unpublished";
export const RESTORE_ACTION = "place.restored";
export const PIN_ACTION = "place.pinned";

export type ListingState = {
  placeId: string;
  name: string;
  citySlug: string;
  listingStatus: "listed" | "hidden";
  /** True only for a place a moderator unpublished and nobody restored. */
  restorable: boolean;
  lat: number | null;
  lng: number | null;
};

export type ListingActionResult =
  | { ok: true; state: ListingState }
  | { ok: false; reason: "not-found" | "not-listed" | "not-restorable" | "bad-pin" };

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function lastModeratorAction(db: DatabaseClient, placeId: string): Promise<string | null> {
  const rows = await db.all<{ action?: unknown }>(sql`
    SELECT action FROM audit_log
    WHERE target_type = 'place' AND target_id = ${placeId}
      AND action IN (${UNPUBLISH_ACTION}, ${RESTORE_ACTION})
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `);
  return typeof rows[0]?.action === "string" ? rows[0].action : null;
}

/** The moderator's view of one place, or null when the id names nothing halal. */
export async function getListingState(
  placeId: string,
  client: Client = database(),
): Promise<ListingState | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, name, city_slug, listing_status, lat, lng FROM places
    WHERE id = ${placeId} AND halal_confirmed = 1
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const listed = row.listing_status === "listed";
  return {
    placeId: String(row.id),
    name: String(row.name ?? ""),
    citySlug: String(row.city_slug ?? ""),
    listingStatus: listed ? "listed" : "hidden",
    restorable: !listed && (await lastModeratorAction(db, placeId)) === UNPUBLISH_ACTION,
    lat: numberOrNull(row.lat),
    lng: numberOrNull(row.lng),
  };
}

/** Hide a listed place. The reason is required and kept on the audit entry. */
export async function unpublishPlace(
  placeId: string,
  moderatorUserId: string,
  reason: string,
  client: Client = database(),
): Promise<ListingActionResult> {
  const db = await client;
  const changed = await db.all<{ id: string }>(sql`
    UPDATE places SET listing_status = 'hidden'
    WHERE id = ${placeId} AND halal_confirmed = 1 AND listing_status = 'listed'
    RETURNING id
  `);
  if (!changed.length) {
    const state = await getListingState(placeId, db);
    return { ok: false, reason: state ? "not-listed" : "not-found" };
  }
  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: UNPUBLISH_ACTION,
      targetType: "place",
      targetId: placeId,
      reason,
      source: "moderation",
      before: { listingStatus: "listed" },
      after: { listingStatus: "hidden" },
    },
    db,
  );
  const state = await getListingState(placeId, db);
  return state ? { ok: true, state } : { ok: false, reason: "not-found" };
}

/** List a place again, only if a moderator unpublished it here. */
export async function restorePlace(
  placeId: string,
  moderatorUserId: string,
  reason: string | null,
  client: Client = database(),
): Promise<ListingActionResult> {
  const db = await client;
  const before = await getListingState(placeId, db);
  if (!before) return { ok: false, reason: "not-found" };
  if (!before.restorable) return { ok: false, reason: "not-restorable" };
  const changed = await db.all<{ id: string }>(sql`
    UPDATE places SET listing_status = 'listed'
    WHERE id = ${placeId} AND halal_confirmed = 1 AND listing_status = 'hidden'
    RETURNING id
  `);
  if (!changed.length) return { ok: false, reason: "not-restorable" };
  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: RESTORE_ACTION,
      targetType: "place",
      targetId: placeId,
      reason,
      source: "moderation",
      before: { listingStatus: "hidden" },
      after: { listingStatus: "listed" },
    },
    db,
  );
  const state = await getListingState(placeId, db);
  return state ? { ok: true, state } : { ok: false, reason: "not-found" };
}

/** A latitude and longitude pair, or null when either is out of range. */
export function parsePin(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const toNumber = (value: unknown) =>
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  const latitude = toNumber(lat);
  const longitude = toNumber(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { lat: latitude, lng: longitude };
}

/** Put a listed place on the map. */
export async function pinPlace(
  placeId: string,
  moderatorUserId: string,
  pin: { lat: number; lng: number },
  client: Client = database(),
): Promise<ListingActionResult> {
  const db = await client;
  const before = await getListingState(placeId, db);
  if (!before) return { ok: false, reason: "not-found" };
  if (before.listingStatus !== "listed") return { ok: false, reason: "not-listed" };
  await db.run(sql`
    UPDATE places SET lat = ${pin.lat}, lng = ${pin.lng}
    WHERE id = ${placeId} AND halal_confirmed = 1 AND listing_status = 'listed'
  `);
  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: PIN_ACTION,
      targetType: "place",
      targetId: placeId,
      reason: null,
      source: "moderation",
      before: { lat: before.lat, lng: before.lng },
      after: pin,
    },
    db,
  );
  const state = await getListingState(placeId, db);
  return state ? { ok: true, state } : { ok: false, reason: "not-found" };
}

export type HiddenByModerator = {
  placeId: string;
  name: string;
  citySlug: string;
  reason: string | null;
  hiddenAt: number;
};

/** Places a moderator unpublished and nobody restored, newest first. */
export async function listModeratorHiddenPlaces(
  client: Client = database(),
): Promise<HiddenByModerator[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT p.id, p.name, p.city_slug, a.reason, a.created_at
    FROM audit_log AS a
    INNER JOIN places AS p ON p.id = a.target_id
    WHERE a.target_type = 'place' AND a.action = ${UNPUBLISH_ACTION}
      AND p.listing_status = 'hidden' AND p.halal_confirmed = 1
      AND NOT EXISTS (
        SELECT 1 FROM audit_log AS later
        WHERE later.target_type = 'place' AND later.target_id = a.target_id
          AND later.action IN (${UNPUBLISH_ACTION}, ${RESTORE_ACTION})
          AND (later.created_at > a.created_at
            OR (later.created_at = a.created_at AND later.rowid > a.rowid))
      )
    ORDER BY a.created_at DESC
    LIMIT 100
  `);
  return rows.map((row) => ({
    placeId: String(row.id),
    name: String(row.name ?? ""),
    citySlug: String(row.city_slug ?? ""),
    reason: typeof row.reason === "string" ? row.reason : null,
    hiddenAt: typeof row.created_at === "number" ? row.created_at : 0,
  }));
}
