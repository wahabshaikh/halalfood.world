/**
 * Follows, follow requests and blocks (spec §5.2). Following a private account
 * makes a request; a block removes follows both ways and hides each side from
 * the other.
 */
import { sql } from "drizzle-orm";
import { decideFollow, type FollowStatus, type Relation } from "@halalfood/core/people";
import { database } from "../db";
import { runBatch } from "./checks-repository";
import { notificationStatement } from "./notifications";
import { getProfileByHandle, type Profile } from "./profiles";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type PersonCard = {
  userId: string;
  handle: string;
  name: string;
  avatarKey: string | null;
  homeCitySlug: string | null;
};

function toCard(row: Record<string, unknown>): PersonCard {
  return {
    userId: String(row.user_id),
    handle: String(row.handle),
    name: String(row.display_name ?? row.handle),
    avatarKey: (row.avatar_key as string | null) ?? null,
    homeCitySlug: (row.home_city_slug as string | null) ?? null,
  };
}

export async function blockedEitherWay(a: string, b: string, client: Client = database()): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    SELECT 1 FROM blocks WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a}) LIMIT 1
  `);
  return rows.length > 0;
}

export async function relationTo(viewerId: string | null, target: Profile, client: Client = database()): Promise<Relation> {
  if (!viewerId) return "none";
  if (viewerId === target.userId) return "self";
  const db = await client;
  const [row] = await db.all<{ blocked: number; status: FollowStatus | null }>(sql`
    SELECT
      EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ${viewerId} AND blocked_id = ${target.userId}) AS blocked,
      (SELECT status FROM follows WHERE follower_id = ${viewerId} AND followee_id = ${target.userId}) AS status
  `);
  if (Number(row?.blocked) === 1) return "blocked";
  if (row?.status === "accepted") return "following";
  if (row?.status === "pending") return "requested";
  return "none";
}

export type FollowResult = { ok: true; status: FollowStatus } | { ok: false; status: number; error: string };

/** Follow `handle`. Private accounts get a request; `autoAccept` is for invite links. */
export async function follow(
  viewerId: string,
  handle: string,
  options: { autoAccept?: boolean } = {},
  client: Client = database(),
  now = Date.now(),
): Promise<FollowResult> {
  const db = await client;
  const target = await getProfileByHandle(handle, db);
  if (!target || target.suspended) return { ok: false, status: 404, error: "That person could not be found." };
  const [existing] = await db.all<{ status: FollowStatus }>(sql`
    SELECT status FROM follows WHERE follower_id = ${viewerId} AND followee_id = ${target.userId}
  `);
  const decision = decideFollow({
    followerId: viewerId,
    followeeId: target.userId,
    followeeIsPrivate: target.isPrivate && !options.autoAccept,
    blockedEitherWay: await blockedEitherWay(viewerId, target.userId, db),
    existing: existing?.status ?? null,
  });
  if (decision.action === "reject")
    return decision.reason === "self"
      ? { ok: false, status: 400, error: "You can’t follow yourself." }
      : { ok: false, status: 404, error: "That person could not be found." };
  if (decision.action === "noop") return { ok: true, status: decision.status };
  const note = notificationStatement(
    {
      userId: target.userId,
      kind: decision.status === "pending" ? "follow-request" : "follow",
      actorId: viewerId,
      dedupeKey: `${decision.status === "pending" ? "follow-request" : "follow"}:${viewerId}`,
    },
    now,
  );
  await runBatch(db, [
    sql`INSERT INTO follows (follower_id, followee_id, status, created_at, updated_at)
        VALUES (${viewerId}, ${target.userId}, ${decision.status}, ${now}, ${now})
        ON CONFLICT (follower_id, followee_id) DO NOTHING`,
    ...(note ? [note] : []),
  ]);
  return { ok: true, status: decision.status };
}

export async function unfollow(viewerId: string, handle: string, client: Client = database()): Promise<boolean> {
  const db = await client;
  const target = await getProfileByHandle(handle, db);
  if (!target) return false;
  await db.run(sql`DELETE FROM follows WHERE follower_id = ${viewerId} AND followee_id = ${target.userId}`);
  return true;
}

/** Accept or decline a pending request from `handle` to the signed-in person. */
export async function answerRequest(
  userId: string,
  handle: string,
  accept: boolean,
  client: Client = database(),
  now = Date.now(),
): Promise<boolean> {
  const db = await client;
  const requester = await getProfileByHandle(handle, db);
  if (!requester) return false;
  const [pending] = await db.all(sql`
    SELECT 1 FROM follows WHERE follower_id = ${requester.userId} AND followee_id = ${userId} AND status = 'pending'
  `);
  if (!pending) return false;
  if (!accept) {
    await db.run(sql`DELETE FROM follows WHERE follower_id = ${requester.userId} AND followee_id = ${userId} AND status = 'pending'`);
    return true;
  }
  const note = notificationStatement(
    { userId: requester.userId, kind: "follow-accepted", actorId: userId, dedupeKey: `follow-accepted:${userId}` },
    now,
  );
  await runBatch(db, [
    sql`UPDATE follows SET status = 'accepted', updated_at = ${now}
        WHERE follower_id = ${requester.userId} AND followee_id = ${userId} AND status = 'pending'`,
    ...(note ? [note] : []),
  ]);
  return true;
}

export async function block(viewerId: string, handle: string, client: Client = database(), now = Date.now()): Promise<boolean> {
  const db = await client;
  const target = await getProfileByHandle(handle, db);
  if (!target || target.userId === viewerId) return false;
  await runBatch(db, [
    sql`INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (${viewerId}, ${target.userId}, ${now})
        ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    sql`DELETE FROM follows WHERE (follower_id = ${viewerId} AND followee_id = ${target.userId})
        OR (follower_id = ${target.userId} AND followee_id = ${viewerId})`,
    sql`DELETE FROM list_members WHERE user_id = ${target.userId} AND list_id IN (SELECT id FROM lists WHERE owner_id = ${viewerId})`,
  ]);
  return true;
}

export async function unblock(viewerId: string, handle: string, client: Client = database()): Promise<boolean> {
  const db = await client;
  const target = await getProfileByHandle(handle, db);
  if (!target) return false;
  await db.run(sql`DELETE FROM blocks WHERE blocker_id = ${viewerId} AND blocked_id = ${target.userId}`);
  return true;
}

export async function listRequests(userId: string, client: Client = database()): Promise<PersonCard[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT pr.* FROM follows f JOIN profiles pr ON pr.user_id = f.follower_id
    WHERE f.followee_id = ${userId} AND f.status = 'pending' AND pr.suspended_at IS NULL
    ORDER BY f.created_at DESC LIMIT 100
  `);
  return rows.map(toCard);
}

export async function listBlocked(userId: string, client: Client = database()): Promise<PersonCard[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT pr.* FROM blocks b JOIN profiles pr ON pr.user_id = b.blocked_id
    WHERE b.blocker_id = ${userId} ORDER BY b.created_at DESC LIMIT 200
  `);
  return rows.map(toCard);
}

/** Who someone follows, or who follows them (accepted only). */
export async function listConnections(
  userId: string,
  direction: "followers" | "following",
  client: Client = database(),
): Promise<PersonCard[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(
    direction === "followers"
      ? sql`SELECT pr.* FROM follows f JOIN profiles pr ON pr.user_id = f.follower_id
            WHERE f.followee_id = ${userId} AND f.status = 'accepted' AND pr.suspended_at IS NULL
            ORDER BY f.created_at DESC LIMIT 200`
      : sql`SELECT pr.* FROM follows f JOIN profiles pr ON pr.user_id = f.followee_id
            WHERE f.follower_id = ${userId} AND f.status = 'accepted' AND pr.suspended_at IS NULL
            ORDER BY f.created_at DESC LIMIT 200`,
  );
  return rows.map(toCard);
}

/**
 * "Popular in {city}" for onboarding: public accounts ranked by followers plus
 * points over 30 days, minus the viewer, people they follow and blocks.
 */
export async function suggestedPeople(
  viewerId: string,
  citySlug: string | null,
  client: Client = database(),
  now = Date.now(),
): Promise<(PersonCard & { followers: number })[]> {
  const db = await client;
  const since = now - 30 * 24 * 60 * 60 * 1000;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT pr.*,
      (SELECT count(*) FROM follows f WHERE f.followee_id = pr.user_id AND f.status = 'accepted') AS followers,
      (SELECT COALESCE(SUM(pt.points), 0) FROM points pt WHERE pt.user_id = pr.user_id AND pt.created_at >= ${since}
        ${citySlug ? sql`AND pt.city_slug = ${citySlug}` : sql``}) AS recent
    FROM profiles pr
    WHERE pr.user_id <> ${viewerId} AND pr.is_private = 0 AND pr.suspended_at IS NULL AND pr.onboarded_at IS NOT NULL
      ${citySlug ? sql`AND (pr.home_city_slug = ${citySlug} OR EXISTS (SELECT 1 FROM points pt WHERE pt.user_id = pr.user_id AND pt.city_slug = ${citySlug}))` : sql``}
      AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = pr.user_id)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = pr.user_id)
        OR (b.blocker_id = pr.user_id AND b.blocked_id = ${viewerId}))
    ORDER BY followers + recent DESC, pr.created_at ASC
    LIMIT 10
  `);
  return rows.map((row) => ({ ...toCard(row), followers: Number(row.followers ?? 0) }));
}

/**
 * Someone signed up from `/invite/{handle}`: follow the inviter (accepted even
 * if private, since they shared the link), remember who invited them, and tell
 * the inviter. Only once, and only for a brand-new profile.
 */
export async function acceptInvite(userId: string, inviterHandle: string, client: Client = database(), now = Date.now()): Promise<boolean> {
  const db = await client;
  const inviter = await getProfileByHandle(inviterHandle, db);
  if (!inviter || inviter.suspended || inviter.userId === userId) return false;
  const [me] = await db.all<{ invited_by_user_id: string | null; onboarded_at: number | null }>(sql`
    SELECT invited_by_user_id, onboarded_at FROM profiles WHERE user_id = ${userId}
  `);
  if (!me || me.invited_by_user_id || me.onboarded_at) return false;
  const followed = await follow(userId, inviter.handle, { autoAccept: true }, db, now);
  if (!followed.ok) return false;
  const note = notificationStatement(
    { userId: inviter.userId, kind: "invite-joined", actorId: userId, dedupeKey: `invite-joined:${userId}` },
    now,
  );
  await runBatch(db, [
    sql`UPDATE profiles SET invited_by_user_id = ${inviter.userId}, updated_at = ${now} WHERE user_id = ${userId}`,
    ...(note ? [note] : []),
  ]);
  return true;
}
