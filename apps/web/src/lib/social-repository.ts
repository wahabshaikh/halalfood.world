/**
 * D1 access for the social graph: follows, follow requests and blocks, plus
 * the onboarding write that ties a new diner's profile, dietary standard and
 * first want-to-try places together.
 *
 * Nothing here reads or writes halal evidence. The caller owns auth and rate
 * limits, as with the other repositories.
 */

import { and, eq, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  follows,
  listCollaborators,
  listSaves,
  notifications,
  recs,
  userBlocks,
} from "../db/schema";
import {
  applyOnboardingStandard,
  decideFollow,
  relationOf,
  type FollowStatus,
  type OnboardingInput,
  type Relation,
} from "@halalfood/core/social";
import { dedupeKeys } from "@halalfood/core/notifications";
import { tryNotify } from "./notifications-repository";
import {
  getOrCreateProfile,
  getPreferences,
  mapProfile,
  savePreferences,
  type DinerProfile,
} from "./preferences-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

const PAGE_LIMIT = 50;

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A person as listed in followers, following, requests, blocks and search. */
export type PersonSummary = {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarKey: string | null;
  isPrivate: boolean;
};

function mapPerson(row: Record<string, unknown>): PersonSummary {
  const profile = mapProfile(row);
  return {
    userId: profile.userId,
    handle: profile.handle,
    displayName: profile.displayName,
    avatarKey: profile.avatarKey,
    isPrivate: profile.isPrivate,
  };
}

/* ------------------------------------------------------------- blocking -- */

export async function isBlockedEitherWay(
  a: string,
  b: string,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = ${a} AND blocked_id = ${b})
       OR (blocker_id = ${b} AND blocked_id = ${a})
    LIMIT 1
  `);
  return rows.length > 0;
}

/** Rows in a list table that tie `member` to a list owned by `owner`. */
function ownedBy(owner: string, member: string) {
  return sql`user_id = ${member} AND list_id IN (SELECT id FROM place_lists WHERE user_id = ${owner})`;
}

/**
 * Block someone. Any follow or request between the two, in either direction,
 * is removed in the same batch so a block never leaves a half-connected pair.
 * The same goes for shared lists: neither keeps a collaborator seat or a save
 * on the other's lists. Recs and notifications between them go too, so nothing
 * from the blocked person lingers in an inbox.
 */
export async function blockUser(
  blockerId: string,
  blockedId: string,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await db.batch([
    db
      .insert(userBlocks)
      .values({ blockerId, blockedId, createdAt: new Date() })
      .onConflictDoNothing(),
    db
      .delete(follows)
      .where(
        or(
          and(eq(follows.followerId, blockerId), eq(follows.followeeId, blockedId)),
          and(eq(follows.followerId, blockedId), eq(follows.followeeId, blockerId)),
        ),
      ),
    db.delete(listCollaborators).where(ownedBy(blockerId, blockedId)),
    db.delete(listCollaborators).where(ownedBy(blockedId, blockerId)),
    db.delete(listSaves).where(ownedBy(blockerId, blockedId)),
    db.delete(listSaves).where(ownedBy(blockedId, blockerId)),
    db
      .delete(notifications)
      .where(
        or(
          and(eq(notifications.userId, blockerId), eq(notifications.actorId, blockedId)),
          and(eq(notifications.userId, blockedId), eq(notifications.actorId, blockerId)),
        ),
      ),
    db
      .delete(recs)
      .where(
        or(
          and(eq(recs.senderId, blockerId), eq(recs.recipientId, blockedId)),
          and(eq(recs.senderId, blockedId), eq(recs.recipientId, blockerId)),
        ),
      ),
  ] as unknown as Parameters<typeof db.batch>[0]);
}

export async function unblockUser(
  blockerId: string,
  blockedId: string,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)));
}

export async function listBlocked(
  userId: string,
  client: Client = database(),
): Promise<PersonSummary[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT p.user_id, p.handle, p.display_name, p.avatar_key, p.is_private
    FROM user_blocks AS b
    JOIN user_profiles AS p ON p.user_id = b.blocked_id
    WHERE b.blocker_id = ${userId}
    ORDER BY b.created_at DESC
    LIMIT ${PAGE_LIMIT}
  `);
  return rows.map(mapPerson);
}

/* -------------------------------------------------------------- follows -- */

export async function getFollowStatus(
  followerId: string,
  followeeId: string,
  client: Client = database(),
): Promise<FollowStatus | null> {
  const db = await client;
  const rows = await db.all<{ status?: unknown }>(sql`
    SELECT status FROM follows
    WHERE follower_id = ${followerId} AND followee_id = ${followeeId}
    LIMIT 1
  `);
  const status = rows[0]?.status;
  return status === "accepted" || status === "pending" ? status : null;
}

export type FollowResult =
  | { ok: true; status: FollowStatus }
  | { ok: false; reason: "self" | "blocked" | "not-found" };

/** Follow, or request to follow when the account is private. */
export async function followUser(
  followerId: string,
  followeeHandle: string,
  client: Client = database(),
): Promise<FollowResult> {
  const db = await client;
  const target = (
    await db.all<Record<string, unknown>>(sql`
      SELECT user_id, is_private FROM user_profiles WHERE handle = ${followeeHandle} LIMIT 1
    `)
  )[0];
  if (!target) return { ok: false, reason: "not-found" };
  const followeeId = String(target.user_id);

  const [blocked, existing] = await Promise.all([
    isBlockedEitherWay(followerId, followeeId, db),
    getFollowStatus(followerId, followeeId, db),
  ]);
  const decision = decideFollow({
    followerId,
    followeeId,
    followeeIsPrivate: target.is_private === 1 || target.is_private === true,
    blockedEitherWay: blocked,
    existing,
  });
  if (decision.action === "reject")
    // A blocked follower sees the same answer as a missing account.
    return { ok: false, reason: decision.reason === "self" ? "self" : "not-found" };
  if (decision.action === "noop") return { ok: true, status: decision.status };

  const now = Date.now();
  await db.run(sql`
    INSERT INTO follows (follower_id, followee_id, status, created_at, updated_at)
    VALUES (${followerId}, ${followeeId}, ${decision.status}, ${now}, ${now})
    ON CONFLICT(follower_id, followee_id) DO NOTHING
  `);
  // Following again after an unfollow does not ping them a second time.
  await tryNotify(
    {
      userId: followeeId,
      kind: decision.status === "accepted" ? "follow" : "follow-request",
      actorId: followerId,
      dedupeKey:
        decision.status === "accepted"
          ? dedupeKeys.follow(followerId)
          : dedupeKeys.followRequest(followerId),
    },
    db,
  );
  return { ok: true, status: decision.status };
}

/** Unfollow, or withdraw a pending request. Idempotent. */
export async function unfollowUser(
  followerId: string,
  followeeHandle: string,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await db.run(sql`
    DELETE FROM follows
    WHERE follower_id = ${followerId}
      AND followee_id = (SELECT user_id FROM user_profiles WHERE handle = ${followeeHandle})
  `);
}

/** Accept or decline a request someone made to follow the signed-in diner. */
export async function respondToFollowRequest(
  followeeId: string,
  followerHandle: string,
  accept: boolean,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const followerId = (
    await db.all<{ user_id?: unknown }>(sql`
      SELECT user_id FROM user_profiles WHERE handle = ${followerHandle} LIMIT 1
    `)
  )[0]?.user_id;
  if (typeof followerId !== "string") return false;
  const pending = await getFollowStatus(followerId, followeeId, db);
  if (pending !== "pending") return false;

  if (accept) {
    await db.run(sql`
      UPDATE follows SET status = 'accepted', updated_at = ${Date.now()}
      WHERE follower_id = ${followerId} AND followee_id = ${followeeId} AND status = 'pending'
    `);
    await tryNotify(
      {
        userId: followerId,
        kind: "follow-accepted",
        actorId: followeeId,
        dedupeKey: dedupeKeys.followAccepted(followeeId),
      },
      db,
    );
  } else
    await db.run(sql`
      DELETE FROM follows
      WHERE follower_id = ${followerId} AND followee_id = ${followeeId} AND status = 'pending'
    `);
  return true;
}

/** Going public settles every request that was waiting on approval. */
export async function acceptAllPendingRequests(
  followeeId: string,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await db.run(sql`
    UPDATE follows SET status = 'accepted', updated_at = ${Date.now()}
    WHERE followee_id = ${followeeId} AND status = 'pending'
  `);
}

export type FollowCounts = { followers: number; following: number };

export async function followCounts(
  userId: string,
  client: Client = database(),
): Promise<FollowCounts> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE followee_id = ${userId} AND status = 'accepted') AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ${userId} AND status = 'accepted') AS following
  `);
  return { followers: count(rows[0]?.followers), following: count(rows[0]?.following) };
}

export type FollowListKind = "followers" | "following" | "requests";

/**
 * People connected to a diner. Anyone the viewer has a block with, in either
 * direction, is left out so blocking also hides people from these lists.
 */
export async function listConnections(
  userId: string,
  kind: FollowListKind,
  viewerId: string | null,
  client: Client = database(),
): Promise<PersonSummary[]> {
  const db = await client;
  const [otherColumn, ownColumn, status] =
    kind === "followers"
      ? ["follower_id", "followee_id", "accepted"]
      : kind === "following"
        ? ["followee_id", "follower_id", "accepted"]
        : ["follower_id", "followee_id", "pending"];
  const viewer = viewerId ?? "";
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT p.user_id, p.handle, p.display_name, p.avatar_key, p.is_private
    FROM follows AS f
    JOIN user_profiles AS p ON p.user_id = f.${sql.raw(otherColumn)}
    WHERE f.${sql.raw(ownColumn)} = ${userId}
      AND f.status = ${status}
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks AS b
        WHERE (b.blocker_id = ${viewer} AND b.blocked_id = p.user_id)
           OR (b.blocker_id = p.user_id AND b.blocked_id = ${viewer})
      )
    ORDER BY f.created_at DESC
    LIMIT ${PAGE_LIMIT}
  `);
  return rows.map(mapPerson);
}

/** How a signed-in (or signed-out) viewer stands to a profile. */
export async function relationTo(
  viewerId: string | null,
  profileUserId: string,
  client: Client = database(),
): Promise<Relation> {
  if (!viewerId) return "none";
  if (viewerId === profileUserId) return "self";
  const db = await client;
  const [blocked, follow] = await Promise.all([
    isBlockedEitherWay(viewerId, profileUserId, db),
    getFollowStatus(viewerId, profileUserId, db),
  ]);
  return relationOf({ viewerId, profileUserId, blockedEitherWay: blocked, follow });
}

/* --------------------------------------------------------------- search -- */

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Find diners by handle or name. Only people who finished onboarding are
 * listed, and blocks hide people from each other.
 */
export async function searchPeople(
  query: string,
  viewerId: string | null,
  limit = 20,
  client: Client = database(),
): Promise<PersonSummary[]> {
  const term = query.trim().replace(/^@/, "").toLowerCase();
  if (term.length < 2) return [];
  const db = await client;
  const prefix = `${escapeLike(term)}%`;
  const contains = `%${escapeLike(term)}%`;
  const viewer = viewerId ?? "";
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT p.user_id, p.handle, p.display_name, p.avatar_key, p.is_private
    FROM user_profiles AS p
    WHERE p.onboarded_at IS NOT NULL
      AND p.user_id <> ${viewer}
      AND (p.handle LIKE ${prefix} ESCAPE '\\' OR lower(p.display_name) LIKE ${contains} ESCAPE '\\')
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks AS b
        WHERE (b.blocker_id = ${viewer} AND b.blocked_id = p.user_id)
           OR (b.blocker_id = p.user_id AND b.blocked_id = ${viewer})
      )
    ORDER BY (p.handle = ${term}) DESC, p.handle
    LIMIT ${Math.min(Math.max(Math.trunc(limit) || 20, 1), 50)}
  `);
  return rows.map(mapPerson);
}

export async function isHandleAvailable(
  handle: string,
  exceptUserId: string | null,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    SELECT 1 FROM user_profiles
    WHERE handle = ${handle} AND user_id <> ${exceptUserId ?? ""}
    LIMIT 1
  `);
  return rows.length === 0;
}

/* ----------------------------------------------------------- onboarding -- */

export type OnboardingResult =
  | { ok: true; profile: DinerProfile; followed: FollowStatus | null }
  | { ok: false; reason: "handle-taken" };

/**
 * Finish onboarding: claim the handle, save the name and home city, write the
 * chosen standard to the same preferences the standards page edits, save the
 * want-to-try places and follow whoever sent the invite link.
 *
 * Want-to-try places only count if they are listed places; anything else is
 * dropped rather than failing the whole step.
 */
export async function completeOnboarding(
  userId: string,
  input: OnboardingInput,
  client: Client = database(),
): Promise<OnboardingResult> {
  const db = await client;
  const current = await getOrCreateProfile(userId, db);
  if (input.handle !== current.handle && !(await isHandleAvailable(input.handle, userId, db)))
    return { ok: false, reason: "handle-taken" };

  const now = Date.now();
  try {
    await db.run(sql`
      UPDATE user_profiles SET
        handle = ${input.handle},
        display_name = ${input.displayName},
        home_city_slug = ${input.homeCitySlug ?? current.homeCitySlug},
        onboarded_at = COALESCE(onboarded_at, ${now}),
        updated_at = ${now}
      WHERE user_id = ${userId}
    `);
  } catch {
    // The unique index is the authority when two people claim a handle at once.
    return { ok: false, reason: "handle-taken" };
  }

  if (input.standard) {
    const preferences = await getPreferences(userId, db);
    await savePreferences(
      userId,
      {
        ...applyOnboardingStandard(preferences, input.standard),
        homeCitySlug: input.homeCitySlug ?? preferences.homeCitySlug,
      },
      db,
    );
  }

  for (const placeId of input.wantToTry)
    await db.run(sql`
      INSERT INTO saved_places (user_id, place_id, created_at)
      SELECT ${userId}, id, ${now} FROM places WHERE id = ${placeId} AND halal_confirmed = 1
      ON CONFLICT (user_id, place_id) DO NOTHING
    `);

  let followed: FollowStatus | null = null;
  if (input.invitedByHandle && input.invitedByHandle !== input.handle) {
    const inviterId = (
      await db.all<{ user_id?: unknown }>(sql`
        SELECT user_id FROM user_profiles WHERE handle = ${input.invitedByHandle} LIMIT 1
      `)
    )[0]?.user_id;
    if (typeof inviterId === "string" && inviterId !== userId) {
      await db.run(sql`
        UPDATE user_profiles SET invited_by_user_id = ${inviterId}
        WHERE user_id = ${userId} AND invited_by_user_id IS NULL
      `);
      const result = await followUser(userId, input.invitedByHandle, db);
      if (result.ok) followed = result.status;
    }
  }

  return { ok: true, profile: await getOrCreateProfile(userId, db), followed };
}

export async function setAvatarKey(
  userId: string,
  avatarKey: string | null,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await getOrCreateProfile(userId, db);
  await db.run(sql`
    UPDATE user_profiles SET avatar_key = ${avatarKey}, updated_at = ${Date.now()}
    WHERE user_id = ${userId}
  `);
}
