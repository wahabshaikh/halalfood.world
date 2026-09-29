/**
 * D1 access for the activity feed behind the bell.
 *
 * Notifications are written when the thing happens, with a dedupe key so the
 * same event never tells the same diner twice, and they are never written
 * across a block or to the person who caused them. Writing one is best effort:
 * a like or a comment must still succeed if the notification cannot be saved,
 * so callers use `tryNotify`.
 *
 * A notification reports; it never decides. The halal status alert reads the
 * status history that moderators' decisions already wrote, and nothing here
 * can change a status.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  NOTIFICATION_PAGE_SIZE,
  UNREAD_BADGE_CAP,
  dedupeKeys,
  groupNotifications,
  isNotificationKind,
  kindsForFilter,
  shouldNotifyStatusChange,
  type NotificationFilter,
  type NotificationItem,
  type NotificationKind,
  type NotificationRow,
} from "@halalfood/core/notifications";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type NotifyInput = {
  userId: string;
  kind: NotificationKind;
  actorId?: string | null;
  placeId?: string | null;
  visitId?: string | null;
  listId?: string | null;
  recId?: string | null;
  statusChangeId?: string | null;
  verificationId?: string | null;
  dedupeKey: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** SQL for a fresh notification id, so a fan-out can generate one per row. */
const NEW_ID = sql`lower(hex(randomblob(16)))`;

/**
 * Write one notification. Nothing is written to the diner who caused it, across
 * a block in either direction, or twice for the same dedupe key.
 */
export async function notify(input: NotifyInput, client: Client = database()): Promise<void> {
  const db = await client;
  const actor = input.actorId ?? null;
  await db.run(sql`
    INSERT INTO notifications (
      id, user_id, kind, actor_id, place_id, visit_id, list_id, rec_id,
      status_change_id, verification_id, dedupe_key, created_at
    )
    SELECT ${crypto.randomUUID()}, ${input.userId}, ${input.kind}, ${actor},
      ${input.placeId ?? null}, ${input.visitId ?? null}, ${input.listId ?? null},
      ${input.recId ?? null}, ${input.statusChangeId ?? null},
      ${input.verificationId ?? null}, ${input.dedupeKey}, ${Date.now()}
    WHERE ${input.userId} <> ${actor ?? ""}
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks AS b
        WHERE (b.blocker_id = ${input.userId} AND b.blocked_id = ${actor})
           OR (b.blocker_id = ${actor} AND b.blocked_id = ${input.userId})
      )
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
  `);
}

/** Like `notify`, but a failure is swallowed so the action that caused it still succeeds. */
export async function tryNotify(input: NotifyInput, client: Client = database()): Promise<void> {
  try {
    await notify(input, client);
  } catch {
    // Best effort: the notification is a courtesy, not part of the write.
  }
}

/**
 * Tell everyone who saved a place that its halal status changed. This is the
 * alert only we can send. It fans out in one statement, one row per saver.
 */
export async function notifyStatusChange(
  placeId: string,
  statusChangeId: string,
  previous: string | null,
  next: string,
  client: Client = database(),
): Promise<void> {
  if (!shouldNotifyStatusChange(previous, next)) return;
  try {
    const db = await client;
    await db.run(sql`
      INSERT INTO notifications (
        id, user_id, kind, place_id, status_change_id, dedupe_key, created_at
      )
      SELECT ${NEW_ID}, s.user_id, 'status-changed', ${placeId}, ${statusChangeId},
        ${dedupeKeys.statusChange(statusChangeId)}, ${Date.now()}
      FROM saved_places AS s
      WHERE s.place_id = ${placeId}
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
    `);
  } catch {
    // Best effort, as with every notification.
  }
}

/**
 * Tell the followers who saved a place that someone they follow has been. Only
 * for a visit that was shared to the feed, so a private visit never notifies.
 */
export async function notifyFriendVisit(
  input: { visitId: string; actorId: string; placeId: string },
  client: Client = database(),
): Promise<void> {
  try {
    const db = await client;
    await db.run(sql`
      INSERT INTO notifications (
        id, user_id, kind, actor_id, place_id, visit_id, dedupe_key, created_at
      )
      SELECT ${NEW_ID}, f.follower_id, 'friend-visit', ${input.actorId}, ${input.placeId},
        ${input.visitId}, ${dedupeKeys.friendVisit(input.visitId)}, ${Date.now()}
      FROM follows AS f
      INNER JOIN saved_places AS s
        ON s.user_id = f.follower_id AND s.place_id = ${input.placeId}
      INNER JOIN place_visits AS v ON v.id = ${input.visitId}
      LEFT JOIN user_preferences AS up ON up.user_id = ${input.actorId}
      WHERE f.followee_id = ${input.actorId} AND f.status = 'accepted'
        AND v.visibility = 'public'
        AND COALESCE(up.visibility_visits, 'public') = 'public'
        AND EXISTS (SELECT 1 FROM feed_events AS e WHERE e.visit_id = ${input.visitId})
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks AS b
          WHERE (b.blocker_id = f.follower_id AND b.blocked_id = ${input.actorId})
             OR (b.blocker_id = ${input.actorId} AND b.blocked_id = f.follower_id)
        )
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
    `);
  } catch {
    // Best effort.
  }
}

function mapRow(row: Record<string, unknown>): NotificationRow | null {
  if (!isNotificationKind(row.kind)) return null;
  const handle = text(row.actor_handle);
  return {
    id: String(row.id),
    kind: row.kind,
    createdAt: num(row.created_at),
    readAt: row.read_at === null || row.read_at === undefined ? null : num(row.read_at),
    actor: handle ? { handle, displayName: text(row.actor_name) } : null,
    placeId: text(row.place_id),
    placeName: text(row.place_name),
    visitId: text(row.visit_id),
    listId: text(row.list_id),
    listTitle: text(row.list_title),
    recId: text(row.rec_id),
    statusChange: text(row.next_status)
      ? {
          previous: text(row.previous_status),
          next: String(row.next_status),
          reason: text(row.reason),
        }
      : null,
    checkOutcome:
      row.check_status === "approved" || row.check_status === "rejected" ? row.check_status : null,
  };
}

/** The newest notifications for a diner, with likes and list additions folded together. */
export async function listNotifications(
  userId: string,
  filter: NotificationFilter = "all",
  client: Client = database(),
): Promise<NotificationItem[]> {
  const db = await client;
  const kinds = kindsForFilter(filter);
  const kindFilter = kinds
    ? sql`AND n.kind IN (${sql.join(
        kinds.map((kind) => sql`${kind}`),
        sql`, `,
      )})`
    : sql``;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT n.id, n.kind, n.created_at, n.read_at, n.place_id, n.visit_id, n.list_id, n.rec_id,
      pr.handle AS actor_handle, pr.display_name AS actor_name,
      pl.name AS place_name, l.title AS list_title,
      h.previous_status, h.next_status, h.reason,
      hv.status AS check_status
    FROM notifications AS n
    LEFT JOIN user_profiles AS pr ON pr.user_id = n.actor_id
    LEFT JOIN places AS pl ON pl.id = n.place_id
    LEFT JOIN place_lists AS l ON l.id = n.list_id
    LEFT JOIN place_halal_status_history AS h ON h.id = n.status_change_id
    LEFT JOIN place_halal_verifications AS hv ON hv.id = n.verification_id
    WHERE n.user_id = ${userId} ${kindFilter}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${NOTIFICATION_PAGE_SIZE}
  `);
  return groupNotifications(
    rows.map(mapRow).filter((row): row is NotificationRow => row !== null),
  );
}

/** Unread notifications, counted only up to the badge cap. */
export async function unreadNotificationCount(
  userId: string,
  client: Client = database(),
): Promise<number> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT COUNT(*) AS total FROM (
      SELECT 1 FROM notifications
      WHERE user_id = ${userId} AND read_at IS NULL
      LIMIT ${UNREAD_BADGE_CAP + 1}
    )
  `);
  return num(rows[0]?.total);
}

/** Mark some notifications read, or every one when `ids` is "all". */
export async function markNotificationsRead(
  userId: string,
  ids: readonly string[] | "all",
  client: Client = database(),
): Promise<void> {
  const db = await client;
  const now = Date.now();
  if (ids === "all") {
    await db.run(sql`
      UPDATE notifications SET read_at = ${now}
      WHERE user_id = ${userId} AND read_at IS NULL
    `);
    return;
  }
  const chosen = ids.slice(0, 200);
  if (!chosen.length) return;
  await db.run(sql`
    UPDATE notifications SET read_at = ${now}
    WHERE user_id = ${userId} AND read_at IS NULL
      AND id IN (${sql.join(
        chosen.map((id) => sql`${id}`),
        sql`, `,
      )})
  `);
}
