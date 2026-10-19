import { sql } from "drizzle-orm";
import { memberTrust, type MemberRecord } from "@/lib/core/trust";
import { database } from "@/lib/db";

type Client = Awaited<ReturnType<typeof database>>;

/** The authenticated member's tier, using the same pure rules as community trust. */
export async function memberIdentity(userId: string, db: Client, now = Date.now()) {
  const [row] = await db.all<{
    created_at: number; email_verified: number; suspended: number; moderator: number; creator: number;
    accepted: number; accepted_places: number; rejected: number; rejected30d: number; upheld_reports90d: number;
  }>(sql`
    SELECT u.created_at, u.email_verified, p.suspended_at IS NOT NULL AS suspended,
      EXISTS (SELECT 1 FROM moderators WHERE user_id = u.id) AS moderator,
      EXISTS (SELECT 1 FROM creator_profiles WHERE user_id = u.id AND claimed_at IS NOT NULL) AS creator,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'accepted') AS accepted,
      (SELECT count(DISTINCT place_id) FROM contributions WHERE user_id = u.id AND status = 'accepted') AS accepted_places,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'rejected') AS rejected,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'rejected' AND created_at > ${now - 30 * 86400000}) AS rejected30d,
      coalesce(mt.upheld_reports_90d, 0) AS upheld_reports90d
    FROM "user" u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN member_trust mt ON mt.user_id = u.id
    WHERE u.id = ${userId}
  `);
  const record: MemberRecord = {
    createdAt: Number(row.created_at), emailVerified: Boolean(row.email_verified), suspended: Boolean(row.suspended),
    moderator: Boolean(row.moderator), creator: Boolean(row.creator), accepted: Number(row.accepted),
    acceptedPlaces: Number(row.accepted_places), rejected: Number(row.rejected), rejected30d: Number(row.rejected30d),
    upheldReports90d: Number(row.upheld_reports90d),
  };
  return { user_id: userId, ...memberTrust(record, now) };
}

/** Only the member's own recent contribution history; no network hashes or key ids. */
export async function memberContributions(userId: string, db: Client) {
  return db.all(sql`
    SELECT id, kind, place_id, channel, status, created_at FROM contributions
    WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC LIMIT 10
  `);
}
