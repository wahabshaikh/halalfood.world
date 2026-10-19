import { sql } from "drizzle-orm";
import { FLAG_LABELS, type FlagKind, type FlagReview } from "@/lib/core/contribution-flags";
import { distanceMeters } from "@/lib/core/place-candidates";
import { memberTrust, parseTier } from "@/lib/core/trust";
import { database } from "@/lib/db";
import { runBatch } from "@/lib/checks-repository";
import { recomputeTrust, type TrustResult } from "@/lib/trust";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;
const HOUR = 60 * 60 * 1000;

type VouchRow = { id: string; place_id: string; lat: number | null; lng: number | null; created_at: number };

/** Snapshot suspicious vouches, deduplicating an identical set even after review. */
export async function flagVouches(userId: string, placeId: string, contributionId: string, trust: TrustResult, db: DatabaseClient, now: number): Promise<void> {
  const insert = async (kind: FlagKind, ids: string[]) => {
    const snapshot = JSON.stringify([...new Set(ids)].sort());
    await db.run(sql`
      INSERT INTO contribution_flags (id, kind, user_id, place_id, contribution_ids, status, created_at)
      SELECT ${crypto.randomUUID()}, ${kind}, ${userId}, ${placeId}, ${snapshot}, 'open', ${now}
      WHERE NOT EXISTS (SELECT 1 FROM contribution_flags WHERE kind = ${kind} AND place_id = ${placeId} AND contribution_ids = ${snapshot})
    `);
  };
  const recent = await db.all<VouchRow>(sql`
    SELECT c.id, c.place_id, p.lat, p.lng, c.created_at FROM contributions c JOIN places p ON p.id = c.place_id
    WHERE c.user_id = ${userId} AND c.kind = 'vouch'
      AND (c.created_at >= ${now - HOUR} OR c.id = ${contributionId}) AND c.created_at <= ${now}
  `);
  const current = recent.find((row) => row.id === contributionId)!;
  const burst = recent.filter((row) => row.id === contributionId || row.created_at >= now - 10 * 60 * 1000);
  if (burst.length > 5) await insert("velocity", burst.map((row) => row.id));
  if (current.lat !== null && current.lng !== null) {
    const distant = recent.filter((row) => row.id !== contributionId && row.lat !== null && row.lng !== null &&
      distanceMeters({ lat: current.lat!, lng: current.lng! }, { lat: row.lat!, lng: row.lng! }) > 100_000);
    if (distant.length) await insert("distance", [contributionId, ...distant.map((row) => row.id)]);
  }
  const [member] = await db.all<{
    tier: string | null; created_at: number; email_verified: number; suspended_at: number | null;
    moderator: number; creator: number; submitted_by_user_id: string | null;
  }>(sql`
    SELECT mt.tier, u.created_at, u.email_verified, pr.suspended_at, p.submitted_by_user_id,
      EXISTS (SELECT 1 FROM moderators WHERE user_id = u.id) AS moderator,
      EXISTS (SELECT 1 FROM creator_profiles WHERE user_id = u.id AND claimed_at IS NOT NULL) AS creator
    FROM "user" u JOIN places p ON p.id = ${placeId}
    LEFT JOIN member_trust mt ON mt.user_id = u.id LEFT JOIN profiles pr ON pr.user_id = u.id WHERE u.id = ${userId}
  `);
  const tier = member.suspended_at !== null ? "restricted" : parseTier(member.tier) ?? memberTrust({
    createdAt: member.created_at, emailVerified: Boolean(member.email_verified), suspended: false,
    moderator: Boolean(member.moderator), creator: Boolean(member.creator), accepted: 0, acceptedPlaces: 0,
    rejected: 0, rejected30d: 0, upheldReports90d: 0,
  }, now).tier;
  if (tier === "new" && member.submitted_by_user_id === userId) await insert("self_vouch", [contributionId]);
  for (const cluster of trust.clusters) {
    const rows = await db.all<{ id: string }>(sql`
      SELECT c.id FROM contributions c
      WHERE c.place_id = ${placeId} AND c.kind = 'vouch' AND c.user_id IN (SELECT value FROM json_each(${JSON.stringify(cluster)}))
        AND c.id = (SELECT id FROM contributions WHERE kind = 'vouch' AND ref_table = 'vouches' AND ref_id = c.ref_id ORDER BY created_at DESC LIMIT 1)
    `);
    await insert("ip_cluster", rows.map((row) => row.id));
  }
}

export type FlagView = { id: string; label: string; user: string; placeId: string | null; placeName: string; createdAt: number;
  contributions: { id: string; user: string; place: string; createdAt: number; status: string }[] };

/** Open flags with the members, places and contributions needed for a review. */
export async function listOpenFlags(client: Client = database()): Promise<FlagView[]> {
  const db = await client;
  const rows = await db.all<{ id: string; kind: FlagKind; user: string; place_id: string | null; place_name: string; created_at: number; contribution_ids: string }>(sql`
    SELECT f.*, coalesce(pr.handle, 'Deleted member') AS user, coalesce(p.name, 'Deleted place') AS place_name
    FROM contribution_flags f LEFT JOIN profiles pr ON pr.user_id = f.user_id LEFT JOIN places p ON p.id = f.place_id
    WHERE f.status = 'open' ORDER BY f.created_at ASC LIMIT 200
  `);
  return Promise.all(rows.map(async (row) => ({
    id: row.id, label: FLAG_LABELS[row.kind], user: row.user, placeId: row.place_id, placeName: row.place_name, createdAt: row.created_at,
    contributions: await db.all<FlagView["contributions"][number]>(sql`
      SELECT c.id, coalesce(pr.handle, 'Deleted member') AS user, coalesce(p.name, 'Deleted place') AS place,
        c.created_at AS createdAt, c.status FROM contributions c
      LEFT JOIN profiles pr ON pr.user_id = c.user_id LEFT JOIN places p ON p.id = c.place_id
      WHERE c.id IN (SELECT value FROM json_each(${row.contribution_ids})) ORDER BY c.created_at ASC
    `),
  })));
}

/** Resolve a flag once; Uphold excludes only its snapshot and revokes its points. */
export async function reviewFlag(id: string, moderatorId: string, input: FlagReview, client: Client = database(), now = Date.now()) {
  const db = await client;
  const [flag] = await db.all<{ status: string; contribution_ids: string; place_id: string | null }>(sql`SELECT status, contribution_ids, place_id FROM contribution_flags WHERE id = ${id}`);
  if (!flag) return { ok: false as const, status: 404, error: "That flag could not be found." };
  if (flag.status !== "open") return { ok: false as const, status: 409, error: "That flag was already reviewed." };
  const places = await db.all<{ place_id: string }>(sql`SELECT DISTINCT place_id FROM contributions WHERE id IN (SELECT value FROM json_each(${flag.contribution_ids})) AND place_id IS NOT NULL`);
  const open = sql`EXISTS (SELECT 1 FROM contribution_flags WHERE id = ${id} AND status = 'open')`;
  const status = input.action === "uphold" ? "upheld" : "dismissed";
  await runBatch(db, [
    ...(input.action === "uphold" ? [
      sql`UPDATE contributions SET status = 'rejected', weight = 0, reviewed_by = ${moderatorId}, reviewed_at = ${now}, reason = ${input.reason}
          WHERE id IN (SELECT value FROM json_each(${flag.contribution_ids})) AND ${open}`,
      sql`UPDATE contribution_points SET status = 'revoked' WHERE contribution_id IN (SELECT value FROM json_each(${flag.contribution_ids})) AND ${open}`,
    ] : []),
    sql`INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
      SELECT ${crypto.randomUUID()}, ${moderatorId}, ${`flag-${input.action}`}, 'contribution_flag', ${id}, ${input.reason},
        ${JSON.stringify({ status: "open" })}, ${JSON.stringify({ status, contributionIds: JSON.parse(flag.contribution_ids) })}, ${now} WHERE ${open}`,
    sql`UPDATE contribution_flags SET status = ${status}, reviewed_by = ${moderatorId}, reviewed_at = ${now}, reason = ${input.reason} WHERE id = ${id} AND status = 'open'`,
  ]);
  for (const placeId of new Set([...places.map((row) => row.place_id), ...(flag.place_id ? [flag.place_id] : [])]))
    await recomputeTrust(placeId, db, now);
  return { ok: true as const };
}
