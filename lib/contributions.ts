/**
 * The contributions log and its review (spec §2.2, §2.6, §5.2). A place
 * added by a New or Restricted member is hidden until a moderator approves
 * it; its `place_add` contribution stays pending and its points row waits.
 * Members and above list at once, and the contribution is accepted.
 */
import { sql, type SQL } from "drizzle-orm";
import { POINT_RULES, pointsToGrant } from "@/lib/core/contributions";
import { pointDay } from "@/lib/core/points";
import { TIER_WEIGHT, memberTrust, type MemberRecord, type Tier } from "@/lib/core/trust";
import { database } from "@/lib/db";
import { recomputePlaceStatus, runBatch } from "./checks-repository";
import { publishListingChange } from "./listing-cache";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The member's record for `memberTrust`, counted from the database. Null when the account is gone. */
export async function loadMemberRecord(userId: string, client: Client = database(), now = Date.now()): Promise<MemberRecord | null> {
  const db = await client;
  const [row] = await db.all<Record<string, number | null>>(sql`
    SELECT u.created_at, u.email_verified, pr.suspended_at,
      EXISTS (SELECT 1 FROM moderators WHERE user_id = u.id) AS moderator,
      EXISTS (SELECT 1 FROM creator_profiles WHERE user_id = u.id AND claimed_at IS NOT NULL) AS creator,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'accepted') AS accepted,
      (SELECT count(DISTINCT place_id) FROM contributions WHERE user_id = u.id AND status = 'accepted') AS accepted_places,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'rejected') AS rejected,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'rejected'
        AND coalesce(reviewed_at, created_at) >= ${now - 30 * DAY_MS}) AS rejected_30d,
      (SELECT count(*) FROM reports WHERE target_type = 'user' AND target_id = u.id AND status = 'actioned'
        AND updated_at >= ${now - 90 * DAY_MS}) AS upheld_90d
    FROM "user" u
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE u.id = ${userId}
  `);
  if (!row) return null;
  return {
    createdAt: Number(row.created_at),
    emailVerified: Boolean(row.email_verified),
    suspended: row.suspended_at !== null,
    moderator: Boolean(row.moderator),
    creator: Boolean(row.creator),
    accepted: Number(row.accepted),
    acceptedPlaces: Number(row.accepted_places),
    rejected: Number(row.rejected),
    rejected30d: Number(row.rejected_30d),
    upheldReports90d: Number(row.upheld_90d),
  };
}

/** The member's tier right now. A missing account is Restricted. */
export async function memberTier(userId: string, client: Client = database(), now = Date.now()): Promise<Tier> {
  const record = await loadMemberRecord(userId, client, now);
  return record ? memberTrust(record, now).tier : "restricted";
}

/**
 * The `place_add` contribution for a new place, and its points row when it
 * waits for review. An accepted add is paid through `points` as before, so
 * it gets no `contribution_points` row.
 */
export function placeAddStatements(userId: string, placeId: string, citySlug: string, tier: Tier, pending: boolean, now: number): SQL[] {
  const id = crypto.randomUUID();
  const statements = [
    sql`INSERT INTO contributions (id, user_id, kind, place_id, ref_table, ref_id, channel, status, weight, created_at)
      VALUES (${id}, ${userId}, 'place_add', ${placeId}, 'places', ${placeId}, 'web', ${pending ? "pending" : "accepted"},
        ${TIER_WEIGHT[tier]}, ${now})`,
  ];
  if (pending)
    statements.push(sql`INSERT INTO contribution_points (id, user_id, contribution_id, kind, place_id, city_slug, points, status, day, created_at)
      VALUES (${crypto.randomUUID()}, ${userId}, ${id}, 'place_add', ${placeId}, ${citySlug}, ${POINT_RULES.place_add.points},
        'pending', ${pointDay(now)}, ${now})`);
  return statements;
}

export type PendingPlaceView = {
  placeId: string;
  name: string;
  address: string | null;
  citySlug: string;
  mapsUrl: string | null;
  submittedBy: string | null;
  createdAt: number;
};

/** Places from New and Restricted members waiting on a moderator, oldest first. */
export async function listPendingPlaces(client: Client = database()): Promise<PendingPlaceView[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT p.id, p.name, p.street_address, p.city_slug, p.maps_url, c.created_at, pr.handle
    FROM contributions c
    JOIN places p ON p.id = c.place_id
    LEFT JOIN profiles pr ON pr.user_id = c.user_id
    WHERE c.kind = 'place_add' AND c.status = 'pending'
    ORDER BY c.created_at ASC
    LIMIT 100
  `);
  return rows.map((row) => ({
    placeId: String(row.id),
    name: String(row.name),
    address: (row.street_address as string | null) ?? null,
    citySlug: String(row.city_slug),
    mapsUrl: (row.maps_url as string | null) ?? null,
    submittedBy: (row.handle as string | null) ?? null,
    createdAt: Number(row.created_at),
  }));
}

export type PlaceReviewResult = { ok: true; points: number } | { ok: false; status: number; error: string };

/**
 * Approve or reject a pending place. Approval lists it, accepts the
 * contribution and grants its points under the daily caps; rejection keeps
 * it hidden, rejects the contribution with the reason, revokes its points
 * and excludes the adder's answers. Both write the audit log.
 */
export async function reviewPlaceAdd(
  placeId: string,
  moderatorId: string,
  decision: "approve" | "reject",
  reason: string | null,
  client: Client = database(),
  now = Date.now(),
): Promise<PlaceReviewResult> {
  const db = await client;
  const [row] = await db.all<{ id: string; user_id: string; city_slug: string }>(sql`
    SELECT c.id, c.user_id, p.city_slug FROM contributions c JOIN places p ON p.id = c.place_id
    WHERE c.place_id = ${placeId} AND c.kind = 'place_add' AND c.status = 'pending'
    LIMIT 1
  `);
  if (!row) return { ok: false, status: 404, error: "That place isn’t waiting for review." };
  const status = decision === "approve" ? "accepted" : "rejected";
  const audit = sql`INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
    VALUES (${crypto.randomUUID()}, ${moderatorId}, ${`${decision}-place`}, 'place', ${placeId}, ${reason},
      ${JSON.stringify({ listing_status: "hidden", contribution: "pending" })},
      ${JSON.stringify({ listing_status: decision === "approve" ? "listed" : "hidden", contribution: status })}, ${now})`;
  const review = sql`UPDATE contributions SET status = ${status}, reviewed_by = ${moderatorId}, reviewed_at = ${now}, reason = ${reason}
    WHERE id = ${row.id} AND status = 'pending'`;

  if (decision === "reject") {
    await runBatch(db, [
      review,
      sql`UPDATE contribution_points SET status = 'revoked' WHERE contribution_id = ${row.id}`,
      // check-visibility: moderator — the adder's own answers on a place that never went live.
      sql`UPDATE checks SET excluded = 1 WHERE place_id = ${placeId} AND user_id = ${row.user_id}`,
      sql`DELETE FROM points WHERE place_id = ${placeId} AND user_id = ${row.user_id}`,
      audit,
    ]);
    await recomputePlaceStatus(placeId, db, now);
    return { ok: true, points: 0 };
  }

  const day = pointDay(now);
  const [today] = await db.all<{ points: number | null; awards: number | null }>(sql`
    SELECT sum(points) AS points, sum(kind = 'place_add') AS awards FROM contribution_points
    WHERE user_id = ${row.user_id} AND day = ${day} AND status = 'granted'
  `);
  const points = pointsToGrant("place_add", { points: Number(today?.points ?? 0), awards: Number(today?.awards ?? 0) });
  await runBatch(db, [
    review,
    sql`UPDATE contribution_points SET status = 'granted', points = ${points}, day = ${day} WHERE contribution_id = ${row.id}`,
    sql`UPDATE places SET listing_status = 'listed', updated_at = ${now} WHERE id = ${placeId}`,
    audit,
  ]);
  await publishListingChange({ actorUserId: moderatorId, change: "place-added", placeId, citySlug: row.city_slug }, db).catch(() => null);
  return { ok: true, points };
}
