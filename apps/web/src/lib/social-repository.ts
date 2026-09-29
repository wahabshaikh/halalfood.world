/**
 * D1 access for the social graph: one-way follows and blocks.
 *
 * A block is symmetric in effect. Once either side has blocked the other, no
 * follow can be created between them, any existing follow is removed, and the
 * feed, visit pages and comments stop showing one to the other.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

function count(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/** Resolve a public handle to an account, or null when there is no such diner. */
export async function findUserIdByHandle(
  handle: string,
  client: Client = database(),
): Promise<string | null> {
  const db = await client;
  const rows = await db.all<{ user_id?: unknown }>(sql`
    SELECT user_id FROM user_profiles WHERE handle = ${handle} LIMIT 1
  `);
  const id = rows[0]?.user_id;
  return typeof id === "string" ? id : null;
}

/** Has either account blocked the other? */
export async function isBlockedEitherWay(
  a: string,
  b: string,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ${a} AND blocked_id = ${b})
       OR (blocker_id = ${b} AND blocked_id = ${a})
    LIMIT 1
  `);
  return rows.length > 0;
}

export type Relation = {
  /** The viewer follows this diner and the follow is accepted. */
  following: boolean;
  /** The viewer's follow request is waiting for approval. */
  requested: boolean;
  followedBy: boolean;
  /** The viewer has blocked this diner. */
  blocking: boolean;
  /** This diner has blocked the viewer. */
  blockedBy: boolean;
};

export async function getRelation(
  viewerId: string,
  targetId: string,
  client: Client = database(),
): Promise<Relation> {
  const db = await client;
  const [follows, blocks] = await Promise.all([
    db.all<{ follower_id: string; status: string }>(sql`
      SELECT follower_id, status FROM follows
      WHERE (follower_id = ${viewerId} AND followee_id = ${targetId})
         OR (follower_id = ${targetId} AND followee_id = ${viewerId})
    `),
    db.all<{ blocker_id: string }>(sql`
      SELECT blocker_id FROM blocks
      WHERE (blocker_id = ${viewerId} AND blocked_id = ${targetId})
         OR (blocker_id = ${targetId} AND blocked_id = ${viewerId})
    `),
  ]);
  const mine = follows.find((row) => row.follower_id === viewerId);
  return {
    following: mine?.status === "accepted",
    requested: mine?.status === "pending",
    followedBy: follows.some(
      (row) => row.follower_id === targetId && row.status === "accepted",
    ),
    blocking: blocks.some((row) => row.blocker_id === viewerId),
    blockedBy: blocks.some((row) => row.blocker_id === targetId),
  };
}

export type FollowResult =
  | { ok: true; status: "accepted" | "pending" }
  | { ok: false; reason: "self" | "blocked" };

export async function followUser(
  followerId: string,
  followeeId: string,
  client: Client = database(),
): Promise<FollowResult> {
  if (followerId === followeeId) return { ok: false, reason: "self" };
  const db = await client;
  if (await isBlockedEitherWay(followerId, followeeId, db))
    return { ok: false, reason: "blocked" };
  // Accounts are all public today, so every follow is accepted straight away.
  // The status column exists so private accounts can hold requests later.
  await db.run(sql`
    INSERT INTO follows (follower_id, followee_id, status, created_at)
    VALUES (${followerId}, ${followeeId}, 'accepted', ${Date.now()})
    ON CONFLICT(follower_id, followee_id) DO NOTHING
  `);
  return { ok: true, status: "accepted" };
}

export async function unfollowUser(
  followerId: string,
  followeeId: string,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await db.run(sql`
    DELETE FROM follows WHERE follower_id = ${followerId} AND followee_id = ${followeeId}
  `);
}

/** Block first so the person is hidden even if clearing the follows fails. */
export async function blockUser(
  blockerId: string,
  blockedId: string,
  client: Client = database(),
): Promise<{ ok: true } | { ok: false; reason: "self" }> {
  if (blockerId === blockedId) return { ok: false, reason: "self" };
  const db = await client;
  await db.run(sql`
    INSERT INTO blocks (blocker_id, blocked_id, created_at)
    VALUES (${blockerId}, ${blockedId}, ${Date.now()})
    ON CONFLICT(blocker_id, blocked_id) DO NOTHING
  `);
  await db.run(sql`
    DELETE FROM follows
    WHERE (follower_id = ${blockerId} AND followee_id = ${blockedId})
       OR (follower_id = ${blockedId} AND followee_id = ${blockerId})
  `);
  return { ok: true };
}

export async function unblockUser(
  blockerId: string,
  blockedId: string,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await db.run(sql`
    DELETE FROM blocks WHERE blocker_id = ${blockerId} AND blocked_id = ${blockedId}
  `);
}

export async function countFollows(
  userId: string,
  client: Client = database(),
): Promise<{ followers: number; following: number }> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE followee_id = ${userId} AND status = 'accepted') AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ${userId} AND status = 'accepted') AS following
  `);
  return {
    followers: count(rows[0]?.followers),
    following: count(rows[0]?.following),
  };
}
