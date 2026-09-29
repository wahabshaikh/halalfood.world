/**
 * D1 access for recs: a place or a list sent to a friend with a short note.
 *
 * There is no chat. A rec has one note from the sender and one of two fixed
 * replies from the recipient, so there is nothing open-ended to moderate. The
 * recipient's own dietary standard still filters what their inbox shows, and a
 * rec is taste: nothing here can change a place's halal status.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import { canSendRec, type RecReply, type RecTarget, type ValidatedRec } from "@halalfood/core/recs";
import { dedupeKeys } from "@halalfood/core/notifications";
import { STATUS_COPY, type HalalTaxonomyStatus } from "@halalfood/core/halal-taxonomy";
import { avatarUrl } from "@halalfood/core/social";
import type { UserPreferences } from "@halalfood/core/user-preferences";
import { assessPlaces } from "./feed-repository";
import { tryNotify } from "./notifications-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

const INBOX_LIMIT = 50;

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function truthy(value: unknown): boolean {
  return value === 1 || value === true;
}

function inList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/* ------------------------------------------------------------- sending -- */

export type SendOutcome = {
  handle: string;
  status: "sent" | "already-sent" | "not-a-friend";
};

export type SendResult =
  | { ok: true; outcomes: SendOutcome[] }
  | { ok: false; reason: "target-not-found" | "list-not-shareable" };

/** Whether the sender may put this target in someone else's inbox. */
async function checkTarget(
  senderId: string,
  target: RecTarget,
  db: DatabaseClient,
): Promise<"ok" | "target-not-found" | "list-not-shareable"> {
  if (target.kind === "place") {
    const rows = await db.all(sql`
      SELECT 1 FROM places WHERE id = ${target.id} AND halal_confirmed = 1 LIMIT 1
    `);
    return rows.length ? "ok" : "target-not-found";
  }
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT l.user_id, l.visibility, COALESCE(p.is_private, 0) AS owner_private,
      EXISTS (
        SELECT 1 FROM user_blocks AS b
        WHERE (b.blocker_id = ${senderId} AND b.blocked_id = l.user_id)
           OR (b.blocker_id = l.user_id AND b.blocked_id = ${senderId})
      ) AS blocked
    FROM place_lists AS l
    LEFT JOIN user_profiles AS p ON p.user_id = l.user_id
    WHERE l.id = ${target.id}
    LIMIT 1
  `);
  const list = rows[0];
  if (!list || truthy(list.blocked)) return "target-not-found";
  if (list.visibility === "private") return "list-not-shareable";
  // Someone else's list can only be passed on when anyone could open it.
  if (list.user_id !== senderId && (truthy(list.owner_private) || list.visibility !== "public"))
    return "list-not-shareable";
  return "ok";
}

/**
 * Send a rec to each handle. Recipients must be people the sender follows or
 * who follow the sender, with no block either way; anyone else looks the same
 * as a missing account. The same place or list goes to the same friend once.
 */
export async function sendRecs(
  senderId: string,
  rec: ValidatedRec,
  client: Client = database(),
): Promise<SendResult> {
  const db = await client;
  const checked = await checkTarget(senderId, rec.target, db);
  if (checked !== "ok") return { ok: false, reason: checked };

  const people = await db.all<Record<string, unknown>>(sql`
    SELECT p.user_id, p.handle,
      EXISTS (
        SELECT 1 FROM follows AS f
        WHERE f.follower_id = ${senderId} AND f.followee_id = p.user_id AND f.status = 'accepted'
      ) AS sender_follows,
      EXISTS (
        SELECT 1 FROM follows AS f
        WHERE f.follower_id = p.user_id AND f.followee_id = ${senderId} AND f.status = 'accepted'
      ) AS recipient_follows,
      EXISTS (
        SELECT 1 FROM user_blocks AS b
        WHERE (b.blocker_id = ${senderId} AND b.blocked_id = p.user_id)
           OR (b.blocker_id = p.user_id AND b.blocked_id = ${senderId})
      ) AS blocked
    FROM user_profiles AS p
    WHERE p.handle IN (${inList(rec.recipients)}) AND p.onboarded_at IS NOT NULL
  `);
  const byHandle = new Map(people.map((row) => [String(row.handle), row] as const));

  const outcomes: SendOutcome[] = [];
  for (const handle of rec.recipients) {
    const person = byHandle.get(handle);
    const recipientId = person ? String(person.user_id) : null;
    if (
      !person ||
      !recipientId ||
      !canSendRec({
        senderId,
        recipientId,
        senderFollowsRecipient: truthy(person.sender_follows),
        recipientFollowsSender: truthy(person.recipient_follows),
        blockedEitherWay: truthy(person.blocked),
      })
    ) {
      outcomes.push({ handle, status: "not-a-friend" });
      continue;
    }
    const id = crypto.randomUUID();
    const placeId = rec.target.kind === "place" ? rec.target.id : null;
    const listId = rec.target.kind === "list" ? rec.target.id : null;
    const rows = await db.all<{ id: string }>(sql`
      INSERT INTO recs (id, sender_id, recipient_id, place_id, list_id, note, created_at)
      VALUES (${id}, ${senderId}, ${recipientId}, ${placeId}, ${listId}, ${rec.note}, ${Date.now()})
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (!rows.length) {
      outcomes.push({ handle, status: "already-sent" });
      continue;
    }
    await tryNotify(
      {
        userId: recipientId,
        kind: "rec",
        actorId: senderId,
        placeId,
        listId,
        recId: id,
        dedupeKey: dedupeKeys.rec(id),
      },
      db,
    );
    outcomes.push({ handle, status: "sent" });
  }
  return { ok: true, outcomes };
}

/* ---------------------------------------------------------- recipients -- */

export type RecipientChoice = {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/** The people a diner can send to: those they follow and those who follow them. */
export async function listRecipients(
  userId: string,
  client: Client = database(),
): Promise<RecipientChoice[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT p.handle, p.display_name, p.avatar_key
    FROM user_profiles AS p
    WHERE p.onboarded_at IS NOT NULL AND p.user_id <> ${userId}
      AND p.user_id IN (
        SELECT followee_id FROM follows WHERE follower_id = ${userId} AND status = 'accepted'
        UNION
        SELECT follower_id FROM follows WHERE followee_id = ${userId} AND status = 'accepted'
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks AS b
        WHERE (b.blocker_id = ${userId} AND b.blocked_id = p.user_id)
           OR (b.blocker_id = p.user_id AND b.blocked_id = ${userId})
      )
    ORDER BY p.handle
    LIMIT 200
  `);
  return rows.map((row) => ({
    handle: String(row.handle),
    displayName: text(row.display_name),
    avatarUrl: avatarUrl(String(row.handle), text(row.avatar_key)),
  }));
}

/* --------------------------------------------------------------- inbox -- */

export type RecCard = {
  id: string;
  createdAt: number;
  note: string | null;
  reply: RecReply | null;
  /** Recipient side only: not opened yet. */
  unread: boolean;
  /** The sender in the inbox, the recipient in "sent". */
  person: RecipientChoice;
  target:
    | {
        kind: "place";
        id: string;
        name: string;
        citySlug: string;
        address: string;
        status: HalalTaxonomyStatus;
        statusLabel: string;
      }
    | { kind: "list"; id: string; title: string; ownerHandle: string | null; places: number };
};

export type RecBox = {
  cards: RecCard[];
  /** Place recs left out because the place fails the reader's own standard. */
  hiddenByStandard: number;
};

/**
 * One side of a diner's recs. The inbox leaves out places that fail their own
 * standard and says how many, as the friends feed does; "sent" shows everything
 * the diner chose to send.
 */
export async function listRecs(
  userId: string,
  box: "inbox" | "sent",
  preferences: UserPreferences,
  client: Client = database(),
): Promise<RecBox> {
  const db = await client;
  const ownColumn = box === "inbox" ? "recipient_id" : "sender_id";
  const otherColumn = box === "inbox" ? "sender_id" : "recipient_id";
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT r.id, r.created_at, r.note, r.reply, r.read_at, r.place_id, r.list_id,
      pr.handle, pr.display_name, pr.avatar_key,
      pl.name AS place_name, pl.city_slug, pl.street_address,
      l.title AS list_title, lo.handle AS list_owner_handle,
      (SELECT COUNT(*) FROM place_list_items AS i WHERE i.list_id = r.list_id) AS list_places
    FROM recs AS r
    INNER JOIN user_profiles AS pr ON pr.user_id = r.${sql.raw(otherColumn)}
    LEFT JOIN places AS pl ON pl.id = r.place_id
    LEFT JOIN place_lists AS l ON l.id = r.list_id
    LEFT JOIN user_profiles AS lo ON lo.user_id = l.user_id
    WHERE r.${sql.raw(ownColumn)} = ${userId}
      AND (r.list_id IS NULL OR l.visibility <> 'private')
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${INBOX_LIMIT}
  `);

  const assessed = await assessPlaces(
    rows.map((row) => text(row.place_id)).filter((id): id is string => id !== null),
    db,
  );
  const cards: RecCard[] = [];
  let hiddenByStandard = 0;
  for (const row of rows) {
    const person: RecipientChoice = {
      handle: String(row.handle),
      displayName: text(row.display_name),
      avatarUrl: avatarUrl(String(row.handle), text(row.avatar_key)),
    };
    const base = {
      id: String(row.id),
      createdAt: num(row.created_at),
      note: text(row.note),
      reply: (row.reply === "in" || row.reply === "want-to-try" ? row.reply : null) as RecReply | null,
      unread: box === "inbox" && (row.read_at === null || row.read_at === undefined),
      person,
    };
    const placeId = text(row.place_id);
    if (placeId) {
      const place = assessed.get(placeId);
      if (!place) continue;
      if (box === "inbox" && !place.evaluate(preferences)) {
        hiddenByStandard += 1;
        continue;
      }
      cards.push({
        ...base,
        target: {
          kind: "place",
          id: placeId,
          name: String(row.place_name ?? ""),
          citySlug: String(row.city_slug ?? ""),
          address: String(row.street_address ?? ""),
          status: place.status,
          statusLabel: STATUS_COPY[place.status].label,
        },
      });
    } else {
      cards.push({
        ...base,
        target: {
          kind: "list",
          id: String(row.list_id),
          title: String(row.list_title ?? ""),
          ownerHandle: text(row.list_owner_handle),
          places: num(row.list_places),
        },
      });
    }
  }
  return { cards, hiddenByStandard };
}

export async function unreadRecCount(userId: string, client: Client = database()): Promise<number> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT COUNT(*) AS total FROM (
      SELECT 1 FROM recs WHERE recipient_id = ${userId} AND read_at IS NULL LIMIT 100
    )
  `);
  return num(rows[0]?.total);
}

/** Opening the inbox marks what is in it as seen. */
export async function markRecsRead(userId: string, client: Client = database()): Promise<void> {
  const db = await client;
  await db.run(sql`
    UPDATE recs SET read_at = ${Date.now()}
    WHERE recipient_id = ${userId} AND read_at IS NULL
  `);
}

export type ReplyResult = { ok: true; reply: RecReply } | { ok: false; reason: "not-found" };

/**
 * The recipient answers with one of two fixed replies. "Want to try" also
 * saves a place to their want-to-try list. The sender hears about it once.
 */
export async function replyToRec(
  recId: string,
  userId: string,
  reply: RecReply,
  client: Client = database(),
): Promise<ReplyResult> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    UPDATE recs SET reply = ${reply}, replied_at = ${Date.now()},
      read_at = COALESCE(read_at, ${Date.now()})
    WHERE id = ${recId} AND recipient_id = ${userId}
    RETURNING sender_id, place_id, list_id
  `);
  const row = rows[0];
  if (!row) return { ok: false, reason: "not-found" };

  const placeId = text(row.place_id);
  if (reply === "want-to-try" && placeId)
    await db.run(sql`
      INSERT INTO saved_places (user_id, place_id, created_at)
      SELECT ${userId}, id, ${Date.now()} FROM places WHERE id = ${placeId} AND halal_confirmed = 1
      ON CONFLICT (user_id, place_id) DO NOTHING
    `);

  await tryNotify(
    {
      userId: String(row.sender_id),
      kind: "rec-reply",
      actorId: userId,
      placeId,
      listId: text(row.list_id),
      recId,
      dedupeKey: dedupeKeys.recReply(recId),
    },
    db,
  );
  return { ok: true, reply };
}

/** The name to show on the send page for a place or a list, or null when it cannot be sent. */
export async function describeRecTarget(
  target: RecTarget,
  viewerId: string | null,
  client: Client = database(),
): Promise<{ kind: "place" | "list"; id: string; name: string; detail: string } | null> {
  const db = await client;
  if (target.kind === "place") {
    const row = (
      await db.all<Record<string, unknown>>(sql`
        SELECT name, city_slug FROM places WHERE id = ${target.id} AND halal_confirmed = 1 LIMIT 1
      `)
    )[0];
    return row
      ? { kind: "place", id: target.id, name: String(row.name), detail: String(row.city_slug ?? "") }
      : null;
  }
  const row = (
    await db.all<Record<string, unknown>>(sql`
      SELECT title, user_id, visibility,
        (SELECT COUNT(*) FROM place_list_items AS i WHERE i.list_id = place_lists.id) AS places
      FROM place_lists WHERE id = ${target.id} LIMIT 1
    `)
  )[0];
  if (!row || row.visibility === "private") return null;
  if (row.user_id !== viewerId && row.visibility !== "public") return null;
  return {
    kind: "list",
    id: target.id,
    name: String(row.title),
    detail: `${num(row.places)} ${num(row.places) === 1 ? "place" : "places"}`,
  };
}
