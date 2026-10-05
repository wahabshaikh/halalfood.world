/**
 * The Inbox: Activity (notifications) and Recs (spec §5.2, §6.18, §8). Unread
 * count = unread notifications + unread recs.
 */
import { sql, type SQL } from "drizzle-orm";
import { FACTS, type Fact } from "@halalfood/core/halal";
import { canSendRec, type RecReply, type ValidatedRec } from "@halalfood/core/recs";
import { database } from "../db";
import { runBatch } from "./checks-repository";
import { notificationStatement } from "./notifications";
import { blockedEitherWay } from "./people";
import { parseStatus } from "@halalfood/core/halal";
import type { PlaceCard } from "./place-view";
import { getProfileByHandle } from "./profiles";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export const INBOX_PAGE = 30;

export type Actor = { userId: string; handle: string | null; name: string; avatarKey: string | null };

export type ActivityItem = {
  id: string;
  kind: string;
  text: string;
  href: string;
  actor: Actor | null;
  placeId: string | null;
  createdAt: number;
  unread: boolean;
  /** Follow requests that are still pending show Accept and Decline. */
  pendingRequest: boolean;
};

function actorOf(row: Record<string, unknown>): Actor | null {
  if (!row.actor_id) return null;
  return {
    userId: String(row.actor_id),
    handle: (row.actor_handle as string | null) ?? null,
    name: String(row.actor_name ?? row.actor_user_name ?? "Someone"),
    avatarKey: (row.actor_avatar as string | null) ?? null,
  };
}

function factPhrase(fact: Fact, value: string | null): string {
  const yes = value === "yes";
  switch (fact) {
    case "owned":
      return yes ? "is Muslim-owned" : "is not Muslim-owned";
    case "certified":
      return yes ? "is halal certified" : "is not halal certified";
    case "pork":
      return yes ? "serves pork" : "doesn’t serve pork";
    case "alcohol":
      return yes ? "serves alcohol" : "doesn’t serve alcohol";
  }
}

/** The line for one notification row (spec §8). */
export function activityText(row: Record<string, unknown>): { text: string; href: string } {
  const name = String(row.actor_name ?? row.actor_user_name ?? "Someone").split(" ")[0];
  const place = String(row.place_name ?? "a place");
  const placeHref = row.place_id ? `/place/${row.place_id}` : "/";
  const profileHref = row.actor_handle ? `/u/${row.actor_handle}` : "/";
  switch (row.kind) {
    case "status-changed": {
      if (row.change_fact && (FACTS as readonly unknown[]).includes(row.change_fact))
        return { text: `${place} changed: it now ${factPhrase(row.change_fact as Fact, (row.change_to_value as string) ?? null)}, from 3 recent checks.`, href: placeHref };
      if (row.change_to_status === "verified") return { text: `${place} is now Community verified. You saved it.`, href: placeHref };
      return { text: `${place} is no longer Community verified. You saved it.`, href: placeHref };
    }
    case "follow":
      return { text: `${name} followed you`, href: profileHref };
    case "follow-request":
      return { text: `${name} wants to follow you`, href: profileHref };
    case "follow-accepted":
      return { text: `${name} accepted your request`, href: profileHref };
    case "like":
      return { text: `${name} liked your visit to ${place}`, href: row.check_id ? `/visit/${row.check_id}` : placeHref };
    case "comment":
      return { text: `${name} commented on ${place}`, href: row.check_id ? `/visit/${row.check_id}` : placeHref };
    case "friend-visit":
      return { text: `${name} went to ${place}, on your want-to-try list`, href: row.check_id ? `/visit/${row.check_id}` : placeHref };
    case "list-invite":
      return { text: `${name} invited you to plan “${row.list_title ?? "a list"}”`, href: row.list_id ? `/list/${row.list_id}` : "/saved?tab=lists" };
    case "rec-reply": {
      const target = String(row.rec_place_name ?? row.rec_list_title ?? row.rec_event_title ?? "your rec");
      const href = row.rec_place_id ? `/place/${row.rec_place_id}` : row.rec_list_id ? `/list/${row.rec_list_id}` : row.rec_event_id ? `/event/${row.rec_event_id}` : "/inbox?tab=recs";
      return { text: row.rec_reply === "want-to-try" ? `${name} saved ${target}` : `${name} is in for ${target}`, href };
    }
    case "invite-joined":
      return { text: `${name} joined from your invite`, href: profileHref };
    default:
      return { text: "Something happened", href: "/" };
  }
}

export async function listActivity(userId: string, before: number | null, client: Client = database()): Promise<{ items: ActivityItem[]; next: number | null }> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT n.id, n.kind, n.actor_id, n.place_id, n.check_id, n.list_id, n.created_at, n.read_at,
      ap.handle AS actor_handle, ap.display_name AS actor_name, ap.avatar_key AS actor_avatar, au.name AS actor_user_name,
      p.name AS place_name, l.title AS list_title,
      ch.to_status AS change_to_status, ch.fact AS change_fact, ch.to_value AS change_to_value,
      r.reply AS rec_reply, r.place_id AS rec_place_id, r.list_id AS rec_list_id, r.event_id AS rec_event_id,
      rp.name AS rec_place_name, rl.title AS rec_list_title, re.title AS rec_event_title,
      EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = n.actor_id AND f.followee_id = n.user_id AND f.status = 'pending') AS pending_request
    FROM notifications n
    LEFT JOIN profiles ap ON ap.user_id = n.actor_id
    LEFT JOIN "user" au ON au.id = n.actor_id
    LEFT JOIN places p ON p.id = n.place_id
    LEFT JOIN lists l ON l.id = n.list_id
    LEFT JOIN place_status_changes ch ON ch.id = n.status_change_id
    LEFT JOIN recs r ON r.id = n.rec_id
    LEFT JOIN places rp ON rp.id = r.place_id
    LEFT JOIN lists rl ON rl.id = r.list_id
    LEFT JOIN events re ON re.id = r.event_id
    WHERE n.user_id = ${userId} AND (ap.suspended_at IS NULL)
      AND (n.actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = n.actor_id)
        OR (b.blocker_id = n.actor_id AND b.blocked_id = ${userId})))
      ${before ? sql`AND n.created_at < ${before}` : sql``}
    ORDER BY n.created_at DESC
    LIMIT ${INBOX_PAGE + 1}
  `);
  const items = rows.slice(0, INBOX_PAGE).map((row) => {
    const { text, href } = activityText(row);
    return {
      id: String(row.id),
      kind: String(row.kind),
      text,
      href,
      actor: actorOf(row),
      placeId: (row.place_id as string | null) ?? null,
      createdAt: Number(row.created_at),
      unread: row.read_at === null,
      pendingRequest: row.kind === "follow-request" && Number(row.pending_request) === 1,
    };
  });
  return { items, next: rows.length > INBOX_PAGE ? items[items.length - 1].createdAt : null };
}

export type RecItem = {
  id: string;
  sender: Actor;
  note: string | null;
  createdAt: number;
  unread: boolean;
  reply: RecReply | null;
  target:
    | { kind: "place"; id: string; name: string; area: string | null; status: PlaceCard["status"]; saved: boolean }
    | { kind: "list"; id: string; name: string }
    | { kind: "event"; id: string; name: string; startsAt: number };
};

export async function listRecs(userId: string, before: number | null, client: Client = database()): Promise<{ items: RecItem[]; next: number | null }> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT r.id, r.sender_id AS actor_id, r.note, r.created_at, r.read_at, r.reply, r.place_id, r.list_id, r.event_id,
      ap.handle AS actor_handle, ap.display_name AS actor_name, ap.avatar_key AS actor_avatar, au.name AS actor_user_name,
      p.name AS place_name, p.address_locality AS place_area, s.status, s.progress,
      EXISTS (SELECT 1 FROM saved_places sp WHERE sp.user_id = ${userId} AND sp.place_id = r.place_id) AS saved,
      l.title AS list_title, e.title AS event_title, e.starts_at AS event_starts_at
    FROM recs r
    JOIN "user" au ON au.id = r.sender_id
    LEFT JOIN profiles ap ON ap.user_id = r.sender_id
    LEFT JOIN places p ON p.id = r.place_id
    LEFT JOIN place_status s ON s.place_id = r.place_id
    LEFT JOIN lists l ON l.id = r.list_id
    LEFT JOIN events e ON e.id = r.event_id
    WHERE r.recipient_id = ${userId} AND ap.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = r.sender_id)
        OR (b.blocker_id = r.sender_id AND b.blocked_id = ${userId}))
      ${before ? sql`AND r.created_at < ${before}` : sql``}
    ORDER BY r.created_at DESC
    LIMIT ${INBOX_PAGE + 1}
  `);
  const items: RecItem[] = rows.slice(0, INBOX_PAGE).map((row) => ({
    id: String(row.id),
    sender: actorOf(row)!,
    note: (row.note as string | null) ?? null,
    createdAt: Number(row.created_at),
    unread: row.read_at === null,
    reply: (row.reply as RecReply | null) ?? null,
    target: row.place_id
      ? {
          kind: "place",
          id: String(row.place_id),
          name: String(row.place_name ?? "A place"),
          area: (row.place_area as string | null) ?? null,
          status: parseStatus(row.status, row.progress),
          saved: Number(row.saved) === 1,
        }
      : row.list_id
        ? { kind: "list", id: String(row.list_id), name: String(row.list_title ?? "A list") }
        : { kind: "event", id: String(row.event_id), name: String(row.event_title ?? "An event"), startsAt: Number(row.event_starts_at ?? 0) },
  }));
  return { items, next: rows.length > INBOX_PAGE ? items[items.length - 1].createdAt : null };
}

export async function unreadCount(userId: string, client: Client = database()): Promise<number> {
  const db = await client;
  const [row] = await db.all<{ n: number; r: number }>(sql`
    SELECT
      (SELECT count(*) FROM notifications WHERE user_id = ${userId} AND read_at IS NULL) AS n,
      (SELECT count(*) FROM recs WHERE recipient_id = ${userId} AND read_at IS NULL) AS r
  `);
  return Number(row?.n ?? 0) + Number(row?.r ?? 0);
}

/** Mark some or all notifications and recs read. */
export async function markRead(userId: string, ids: string[] | null, client: Client = database(), now = Date.now()) {
  const db = await client;
  if (ids && !ids.length) return;
  const only = (column: SQL) => (ids ? sql`AND ${column} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql``);
  await runBatch(db, [
    sql`UPDATE notifications SET read_at = ${now} WHERE user_id = ${userId} AND read_at IS NULL ${only(sql`id`)}`,
    sql`UPDATE recs SET read_at = ${now} WHERE recipient_id = ${userId} AND read_at IS NULL ${only(sql`id`)}`,
  ]);
}

/* ------------------------------------------------------------------------ */
/* Sending                                                                   */
/* ------------------------------------------------------------------------ */

export type Recipient = { handle: string; name: string; avatarKey: string | null };

/** People you follow or who follow you, most recently interacted first. */
export async function recipients(userId: string, client: Client = database()): Promise<Recipient[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT pr.handle, pr.display_name, pr.avatar_key,
      MAX(COALESCE((SELECT MAX(created_at) FROM recs WHERE (sender_id = ${userId} AND recipient_id = pr.user_id)
        OR (sender_id = pr.user_id AND recipient_id = ${userId})), 0), f.created_at) AS recent
    FROM follows f
    JOIN profiles pr ON pr.user_id = CASE WHEN f.follower_id = ${userId} THEN f.followee_id ELSE f.follower_id END
    WHERE (f.follower_id = ${userId} OR f.followee_id = ${userId}) AND f.status = 'accepted' AND pr.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = pr.user_id)
        OR (b.blocker_id = pr.user_id AND b.blocked_id = ${userId}))
    GROUP BY pr.user_id
    ORDER BY recent DESC
    LIMIT 100
  `);
  return rows.map((row) => ({ handle: String(row.handle), name: String(row.display_name ?? row.handle), avatarKey: (row.avatar_key as string | null) ?? null }));
}

/** Send a rec to each handle the sender may send to. Returns how many went out. */
export async function sendRecs(senderId: string, rec: ValidatedRec, client: Client = database(), now = Date.now()): Promise<{ sent: number; skipped: string[] }> {
  const db = await client;
  const table = rec.target.kind === "place" ? sql`places` : rec.target.kind === "list" ? sql`lists` : sql`events`;
  const [exists] = await db.all(sql`SELECT 1 FROM ${table} WHERE id = ${rec.target.id} LIMIT 1`);
  if (!exists) return { sent: 0, skipped: rec.recipients };
  const statements: SQL[] = [];
  const skipped: string[] = [];
  for (const handle of rec.recipients) {
    const profile = await getProfileByHandle(handle, db);
    if (!profile || profile.suspended) {
      skipped.push(handle);
      continue;
    }
    const [follow] = await db.all<{ out: number; back: number }>(sql`
      SELECT
        EXISTS (SELECT 1 FROM follows WHERE follower_id = ${senderId} AND followee_id = ${profile.userId} AND status = 'accepted') AS out,
        EXISTS (SELECT 1 FROM follows WHERE follower_id = ${profile.userId} AND followee_id = ${senderId} AND status = 'accepted') AS back
    `);
    const allowed = canSendRec({
      senderId,
      recipientId: profile.userId,
      senderFollowsRecipient: Number(follow?.out) === 1,
      recipientFollowsSender: Number(follow?.back) === 1,
      blockedEitherWay: await blockedEitherWay(senderId, profile.userId, db),
    });
    if (!allowed) {
      skipped.push(handle);
      continue;
    }
    statements.push(sql`
      INSERT INTO recs (id, sender_id, recipient_id, place_id, list_id, event_id, note, created_at)
      VALUES (${crypto.randomUUID()}, ${senderId}, ${profile.userId},
        ${rec.target.kind === "place" ? rec.target.id : null}, ${rec.target.kind === "list" ? rec.target.id : null},
        ${rec.target.kind === "event" ? rec.target.id : null}, ${rec.note}, ${now})
    `);
  }
  if (statements.length) await runBatch(db, statements);
  return { sent: statements.length, skipped };
}

/** Reply to a rec. `want-to-try` on a place also saves it. */
export async function replyRec(userId: string, recId: string, reply: RecReply, client: Client = database(), now = Date.now()) {
  const db = await client;
  const [rec] = await db.all<{ sender_id: string; place_id: string | null }>(sql`
    SELECT sender_id, place_id FROM recs WHERE id = ${recId} AND recipient_id = ${userId}
  `);
  if (!rec) return false;
  const note = notificationStatement(
    { userId: rec.sender_id, kind: "rec-reply", actorId: userId, recId, placeId: rec.place_id, dedupeKey: `rec-reply:${recId}:${reply}` },
    now,
  );
  await runBatch(db, [
    sql`UPDATE recs SET reply = ${reply}, replied_at = ${now}, read_at = COALESCE(read_at, ${now}) WHERE id = ${recId}`,
    ...(reply === "want-to-try" && rec.place_id
      ? [sql`INSERT INTO saved_places (user_id, place_id, created_at) VALUES (${userId}, ${rec.place_id}, ${now}) ON CONFLICT DO NOTHING`]
      : []),
    ...(note ? [note] : []),
  ]);
  return true;
}
