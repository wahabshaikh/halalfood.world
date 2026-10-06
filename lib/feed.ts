/**
 * The Friends feed and a single visit (one check), with likes and comments
 * (spec §5.2, §6.16, §6.17). Every read applies the check visibility rule:
 * unshared checks are the author's alone, nothing crosses a block, and private
 * accounts show only to accepted followers.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Verdict } from "@/lib/core/check";
import { database } from "@/lib/db";
import { runBatch, visibleAuthor } from "./checks-repository";
import { notificationStatement } from "./notifications";
import { PLACE_CARD_COLUMNS, toPlaceCard, type PlaceCard } from "./place-view";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export const FEED_PAGE = 20;

export type Author = { userId: string; handle: string | null; name: string; avatarKey: string | null };

export type Visit = {
  checkId: string;
  author: Author;
  place: PlaceCard;
  verdict: Verdict | null;
  note: string | null;
  shared: boolean;
  dishes: string[];
  photoKeys: string[];
  createdAt: number;
  likes: number;
  comments: number;
  likedByMe: boolean;
  savedByMe: boolean;
};

/** A check the viewer may see. Uses aliases `c` (checks) and `pr` (the author's profile). */
export function visibleCheck(viewerId: string | null): SQL {
  return sql`c.excluded = 0 AND pr.suspended_at IS NULL AND (
    ${viewerId ? sql`c.user_id = ${viewerId} OR` : sql``}
    (c.shared = 1 AND ${visibleAuthor(viewerId)})
  )`;
}

function visitColumns(viewerId: string | null): SQL {
  return sql`
    c.id AS check_id, c.user_id, c.verdict, c.note, c.shared, c.created_at AS check_created_at,
    pr.handle, pr.display_name, pr.avatar_key, u.name AS user_name,
    (SELECT group_concat(d.name, char(31)) FROM (SELECT name FROM check_dishes WHERE check_id = c.id ORDER BY position) d) AS dishes,
    (SELECT group_concat(ph.r2_key, char(31)) FROM (SELECT r2_key FROM place_photos WHERE check_id = c.id ORDER BY created_at) ph) AS photo_keys,
    (SELECT count(*) FROM likes l WHERE l.check_id = c.id) AS like_count,
    (SELECT count(*) FROM comments cm WHERE cm.check_id = c.id AND cm.status = 'visible') AS comment_count,
    ${viewerId ? sql`EXISTS (SELECT 1 FROM likes l WHERE l.check_id = c.id AND l.user_id = ${viewerId})` : sql`0`} AS liked_by_me,
    ${viewerId ? sql`EXISTS (SELECT 1 FROM saved_places sp WHERE sp.place_id = c.place_id AND sp.user_id = ${viewerId})` : sql`0`} AS saved_by_me,
    ${PLACE_CARD_COLUMNS}
  `;
}

const VISIT_FROM = sql`checks c
  JOIN "user" u ON u.id = c.user_id
  LEFT JOIN profiles pr ON pr.user_id = c.user_id
  JOIN places p ON p.id = c.place_id JOIN place_status s ON s.place_id = p.id`;

function split(value: unknown): string[] {
  return typeof value === "string" && value ? value.split("\u001f") : [];
}

function toVisit(row: Record<string, unknown>): Visit {
  return {
    checkId: String(row.check_id),
    author: {
      userId: String(row.user_id),
      handle: (row.handle as string | null) ?? null,
      name: String(row.display_name ?? row.user_name ?? "Someone"),
      avatarKey: (row.avatar_key as string | null) ?? null,
    },
    place: toPlaceCard(row),
    verdict: (row.verdict as Verdict | null) ?? null,
    note: (row.note as string | null) ?? null,
    shared: Number(row.shared) === 1,
    dishes: split(row.dishes),
    photoKeys: split(row.photo_keys),
    createdAt: Number(row.check_created_at),
    likes: Number(row.like_count ?? 0),
    comments: Number(row.comment_count ?? 0),
    likedByMe: Number(row.liked_by_me) === 1,
    savedByMe: Number(row.saved_by_me) === 1,
  };
}

/** Shared checks from accepted followees, newest first. `before` is the last item's time. */
export async function feedPage(
  viewerId: string,
  before: number | null,
  client: Client = database(),
): Promise<{ items: Visit[]; next: number | null }> {
  const db = await client;
  // check-visibility: gated — followees' shared checks, minus blocks and private authors (visibleCheck).
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${visitColumns(viewerId)}
    FROM ${VISIT_FROM}
    WHERE c.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId} AND status = 'accepted')
      AND c.shared = 1 AND p.listing_status <> 'hidden'
      AND ${visibleCheck(viewerId)}
      ${before ? sql`AND c.created_at < ${before}` : sql``}
    ORDER BY c.created_at DESC
    LIMIT ${FEED_PAGE + 1}
  `);
  const items = rows.slice(0, FEED_PAGE).map(toVisit);
  return { items, next: rows.length > FEED_PAGE ? items[items.length - 1].createdAt : null };
}

/** One check, if the viewer may see it. */
export async function getVisit(checkId: string, viewerId: string | null, client: Client = database()): Promise<Visit | null> {
  const db = await client;
  // check-visibility: gated — visibleCheck applies the privacy rule.
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${visitColumns(viewerId)}
    FROM ${VISIT_FROM}
    WHERE c.id = ${checkId} AND ${visibleCheck(viewerId)}
    LIMIT 1
  `);
  return rows[0] ? toVisit(rows[0]) : null;
}

/** Someone's recent shared checks as the viewer may see them (profile page). */
export async function visitsBy(userId: string, viewerId: string | null, limit = 20, client: Client = database()): Promise<Visit[]> {
  const db = await client;
  // check-visibility: gated — visibleCheck applies the privacy rule.
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${visitColumns(viewerId)}
    FROM ${VISIT_FROM}
    WHERE c.user_id = ${userId} AND c.shared = 1 AND p.listing_status <> 'hidden' AND ${visibleCheck(viewerId)}
    ORDER BY c.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map(toVisit);
}

/* ------------------------------------------------------------------------ */
/* Likes                                                                     */
/* ------------------------------------------------------------------------ */

export async function setLike(checkId: string, viewerId: string, on: boolean, client: Client = database(), now = Date.now()) {
  const db = await client;
  const visit = await getVisit(checkId, viewerId, db);
  if (!visit) return null;
  if (!on) {
    await db.run(sql`DELETE FROM likes WHERE check_id = ${checkId} AND user_id = ${viewerId}`);
  } else {
    const note = notificationStatement(
      {
        userId: visit.author.userId,
        kind: "like",
        actorId: viewerId,
        placeId: visit.place.id,
        checkId,
        dedupeKey: `like:${checkId}:${new Date(now).toISOString().slice(0, 10)}`,
      },
      now,
    );
    await runBatch(db, [
      sql`INSERT INTO likes (check_id, user_id, created_at) VALUES (${checkId}, ${viewerId}, ${now}) ON CONFLICT DO NOTHING`,
      ...(note ? [note] : []),
    ]);
  }
  const [row] = await db.all<{ count: number }>(sql`SELECT count(*) AS count FROM likes WHERE check_id = ${checkId}`);
  return { liked: on, likes: Number(row?.count ?? 0) };
}

/** First names of people who liked a check, for "Sara, Omar and 3 others". Blocks are left out. */
export async function likers(checkId: string, viewerId: string | null, limit = 2, client: Client = database()): Promise<string[]> {
  const db = await client;
  const rows = await db.all<{ name: string }>(sql`
    SELECT COALESCE(pr.display_name, u.name) AS name
    FROM likes l JOIN "user" u ON u.id = l.user_id LEFT JOIN profiles pr ON pr.user_id = l.user_id
    WHERE l.check_id = ${checkId} AND pr.suspended_at IS NULL
      ${viewerId ? sql`AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = l.user_id) OR (b.blocker_id = l.user_id AND b.blocked_id = ${viewerId}))` : sql``}
    ORDER BY (l.user_id = ${viewerId ?? ""}) DESC, l.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => String(row.name).split(" ")[0]);
}

/* ------------------------------------------------------------------------ */
/* Comments                                                                  */
/* ------------------------------------------------------------------------ */

export type Comment = { id: string; author: Author; body: string; createdAt: number; mine: boolean };

export async function listComments(checkId: string, viewerId: string | null, client: Client = database()): Promise<Comment[] | null> {
  const db = await client;
  if (!(await getVisit(checkId, viewerId, db))) return null;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT cm.id, cm.user_id, cm.body, cm.created_at, pr.handle, pr.display_name, pr.avatar_key, u.name AS user_name
    FROM comments cm JOIN "user" u ON u.id = cm.user_id LEFT JOIN profiles pr ON pr.user_id = cm.user_id
    WHERE cm.check_id = ${checkId} AND cm.status = 'visible' AND pr.suspended_at IS NULL
      ${viewerId ? sql`AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = cm.user_id) OR (b.blocker_id = cm.user_id AND b.blocked_id = ${viewerId}))` : sql``}
    ORDER BY cm.created_at ASC
    LIMIT 200
  `);
  return rows.map((row) => ({
    id: String(row.id),
    author: {
      userId: String(row.user_id),
      handle: (row.handle as string | null) ?? null,
      name: String(row.display_name ?? row.user_name ?? "Someone"),
      avatarKey: (row.avatar_key as string | null) ?? null,
    },
    body: String(row.body),
    createdAt: Number(row.created_at),
    mine: row.user_id === viewerId,
  }));
}

export function cleanComment(value: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Write a comment." };
  const body = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  if (!body) return { ok: false, error: "Write a comment." };
  if (body.length > 500) return { ok: false, error: "Comments are 500 characters or fewer." };
  return { ok: true, body };
}

/** Add a comment; the author and earlier commenters are told. */
export async function addComment(checkId: string, viewerId: string, body: string, client: Client = database(), now = Date.now()) {
  const db = await client;
  const visit = await getVisit(checkId, viewerId, db);
  if (!visit) return null;
  const id = crypto.randomUUID();
  const earlier = await db.all<{ user_id: string }>(sql`
    SELECT DISTINCT user_id FROM comments WHERE check_id = ${checkId} AND status = 'visible' AND user_id <> ${viewerId}
  `);
  const recipients = new Set([visit.author.userId, ...earlier.map((row) => row.user_id)]);
  const notes = [...recipients]
    .map((userId) =>
      notificationStatement(
        { userId, kind: "comment", actorId: viewerId, placeId: visit.place.id, checkId, dedupeKey: `comment:${id}` },
        now,
      ),
    )
    .filter((note): note is SQL => note !== null);
  await runBatch(db, [
    sql`INSERT INTO comments (id, check_id, user_id, body, status, created_at) VALUES (${id}, ${checkId}, ${viewerId}, ${body}, 'visible', ${now})`,
    ...notes,
  ]);
  return id;
}

/** Delete your own comment, or any comment as a moderator. */
export async function deleteComment(commentId: string, viewerId: string, moderator: boolean, client: Client = database()) {
  const db = await client;
  const [row] = await db.all<{ user_id: string }>(sql`SELECT user_id FROM comments WHERE id = ${commentId}`);
  if (!row) return "missing" as const;
  if (row.user_id !== viewerId && !moderator) return "forbidden" as const;
  await db.run(sql`DELETE FROM comments WHERE id = ${commentId}`);
  return "deleted" as const;
}
