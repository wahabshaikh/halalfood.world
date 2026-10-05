/**
 * Notifications are written when the event happens, once per dedupe key,
 * never across a block and never to the person who caused them (spec §8).
 */
import { sql, type SQL } from "drizzle-orm";
import { database } from "../db";
import type { NOTIFICATION_KINDS } from "../db/schema";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NewNotification = {
  userId: string;
  kind: NotificationKind;
  actorId?: string | null;
  placeId?: string | null;
  checkId?: string | null;
  listId?: string | null;
  recId?: string | null;
  statusChangeId?: string | null;
  dedupeKey: string;
};

/** The INSERT for one notification; skipped when the actor is the recipient or either blocked the other. */
export function notificationStatement(note: NewNotification, now: number): SQL | null {
  if (note.actorId && note.actorId === note.userId) return null;
  const actor = note.actorId ?? null;
  return sql`INSERT OR IGNORE INTO notifications
      (id, user_id, kind, actor_id, place_id, check_id, list_id, rec_id, status_change_id, dedupe_key, created_at)
    SELECT ${crypto.randomUUID()}, ${note.userId}, ${note.kind}, ${actor}, ${note.placeId ?? null},
      ${note.checkId ?? null}, ${note.listId ?? null}, ${note.recId ?? null}, ${note.statusChangeId ?? null},
      ${note.dedupeKey}, ${now}
    WHERE ${actor} IS NULL OR NOT EXISTS (
      SELECT 1 FROM blocks b WHERE (b.blocker_id = ${note.userId} AND b.blocked_id = ${actor})
        OR (b.blocker_id = ${actor} AND b.blocked_id = ${note.userId})
    )`;
}

export async function notify(notes: NewNotification[], client: Client = database(), now = Date.now()) {
  const statements = notes.map((note) => notificationStatement(note, now)).filter((s): s is SQL => s !== null);
  if (!statements.length) return;
  const { runBatch } = await import("./checks-repository");
  await runBatch(await client, statements);
}
