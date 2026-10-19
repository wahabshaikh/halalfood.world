/**
 * Place trust: reads a place's proof from D1, runs the pure rules in
 * `lib/core/trust.ts` (spec §2.3, §2.4) and writes `place_status.trust_score`,
 * `trust_band`, `community_vouchers`, `creator_count` and `badges`.
 *
 * Trust never changes halal status. `recomputePlaceStatus` calls
 * `recomputeTrust` after every status write, because settled and disputed
 * facts feed the score; writes that never touch status (creator
 * verifications, menus) call it directly.
 */
import { sql } from "drizzle-orm";
import { FACTS } from "@/lib/core/halal";
import {
  dampClusters,
  formatBadges,
  isBurst,
  memberTrust,
  parseTier,
  placeBadges,
  placeTrust,
  vouchWeight,
  TIER_WEIGHT,
  type Band,
  type Tier,
} from "@/lib/core/trust";
import { database } from "@/lib/db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type PlaceTrustValues = {
  trustScore: number;
  trustBand: Band;
  communityVouchers: number;
  creatorCount: number;
  badges: string;
};

export type TrustResult = PlaceTrustValues & {
  /** Pork on the menu: the place belongs in the moderation queue. */
  review: boolean;
  /** User ids of each same-network vouch cluster, for the moderation queue. */
  clusters: string[][];
};

type VouchRow = {
  user_id: string;
  at: number;
  user_created_at: number;
  email_verified: number | null;
  suspended_at: number | null;
  invited_by_user_id: string | null;
  added_by_user_id: string | null;
  moderator: string | null;
  creator: string | null;
  tier: string | null;
  weight: number | null;
  contribution_status: string | null;
  ip_hash: string | null;
};

/**
 * Each vouch's counted weight. The member's weight is their `member_trust`
 * projection, or worked out from the account alone when there is none yet.
 * A suspension always wins, and a vouch whose contribution was rejected or
 * reverted doesn't count.
 */
async function loadVouches(db: DatabaseClient, placeId: string, now: number) {
  const rows = await db.all<VouchRow>(sql`
    SELECT v.user_id, v.updated_at AS at, u.created_at AS user_created_at, u.email_verified,
      pr.suspended_at, pr.invited_by_user_id, pl.submitted_by_user_id AS added_by_user_id,
      m.user_id AS moderator, cp.user_id AS creator, mt.tier, mt.weight, c.status AS contribution_status, c.ip_hash
    FROM vouches v
    JOIN "user" u ON u.id = v.user_id
    JOIN places pl ON pl.id = v.place_id
    LEFT JOIN profiles pr ON pr.user_id = v.user_id
    LEFT JOIN moderators m ON m.user_id = v.user_id
    LEFT JOIN creator_profiles cp ON cp.user_id = v.user_id AND cp.claimed_at IS NOT NULL
    LEFT JOIN member_trust mt ON mt.user_id = v.user_id
    LEFT JOIN contributions c ON c.id = (
      SELECT id FROM contributions
      WHERE kind = 'vouch' AND ref_table = 'vouches' AND ref_id = v.user_id || ':' || v.place_id
      ORDER BY created_at DESC LIMIT 1
    )
    WHERE v.place_id = ${placeId}
  `);
  const vouches = rows
    .filter((row) => row.contribution_status !== "rejected" && row.contribution_status !== "reverted")
    .map((row) => {
      const suspended = row.suspended_at !== null && row.suspended_at !== undefined;
      const stored = parseTier(row.tier);
      const member: { tier: Tier; weight: number } = suspended
        ? { tier: "restricted", weight: TIER_WEIGHT.restricted }
        : stored
          ? { tier: stored, weight: Number(row.weight ?? TIER_WEIGHT[stored]) }
          : memberTrust(
              {
                createdAt: Number(row.user_created_at),
                emailVerified: Number(row.email_verified) === 1,
                suspended,
                moderator: row.moderator !== null,
                creator: row.creator !== null,
                accepted: 0,
                acceptedPlaces: 0,
                rejected: 0,
                rejected30d: 0,
                upheldReports90d: 0,
              },
              now,
            );
      const at = Number(row.at);
      const weight = vouchWeight(member.weight, {
        accountAgeMs: at - Number(row.user_created_at),
        placeAddedByInviter: row.invited_by_user_id !== null && row.invited_by_user_id === row.added_by_user_id,
        // Owner claims (place_owners) don't exist yet, so no vouch is an owner's.
        verifiedOwner: false,
      });
      return { userId: String(row.user_id), tier: member.tier, weight, ipHash: row.ip_hash ?? null, at };
    });
  return dampClusters(vouches);
}

type StatusRow = Record<`${(typeof FACTS)[number]}_settled`, "yes" | "no" | null> & { disputed_facts: string };

/** Work out a place's trust from D1 without writing anything. */
export async function computeTrust(placeId: string, client: Client = database(), now = Date.now()): Promise<TrustResult> {
  const db = await client;
  const [status] = await db.all<StatusRow>(sql`
    SELECT owned_settled, certified_settled, pork_settled, alcohol_settled, disputed_facts FROM place_status WHERE place_id = ${placeId}
  `);
  const { vouches, clusters } = await loadVouches(db, placeId, now);
  const counted = vouches.filter((vouch) => vouch.weight > 0);
  const [proof] = await db.all<Record<string, number | null>>(sql`
    SELECT
      (SELECT count(DISTINCT creator_user_id) FROM creator_verifications WHERE place_id = ${placeId}) AS creators,
      EXISTS (SELECT 1 FROM place_signals WHERE place_id = ${placeId} AND source = 'certificate' AND review_status = 'approved'
        AND certified = 'yes' AND (expires_at IS NULL OR expires_at > ${now})) AS certificate,
      EXISTS (SELECT 1 FROM place_signals WHERE place_id = ${placeId} AND source = 'menu' AND review_status = 'approved')
        OR EXISTS (SELECT 1 FROM place_menus WHERE place_id = ${placeId}) AS menu,
      EXISTS (SELECT 1 FROM place_signals WHERE place_id = ${placeId} AND source = 'menu' AND review_status = 'approved' AND pork = 'yes')
        OR EXISTS (SELECT 1 FROM place_menu_check_flags WHERE place_id = ${placeId} AND reason = 'pork') AS pork_on_menu,
      EXISTS (SELECT 1 FROM place_signals WHERE place_id = ${placeId} AND source = 'menu' AND review_status = 'approved' AND alcohol = 'yes')
        OR EXISTS (SELECT 1 FROM place_menu_check_flags WHERE place_id = ${placeId} AND reason = 'alcohol') AS alcohol_on_menu,
      (SELECT count(DISTINCT coalesce(reporter_id, id)) FROM reports
        WHERE target_type = 'place' AND target_id = ${placeId} AND status = 'open') AS open_reports
  `);
  const flag = (name: string) => Number(proof?.[name] ?? 0) === 1;
  const creators = Number(proof?.creators ?? 0);
  // No certifier registry yet (spec §2.3): only an approved certificate gives proof.
  const registryMatch = false;
  const trust = placeTrust({
    certificate: flag("certificate"),
    registryMatch,
    creators,
    communityWeight: counted.reduce((sum, vouch) => sum + vouch.weight, 0),
    settledFacts: FACTS.filter((fact) => status?.[`${fact}_settled`]).length,
    menu: flag("menu"),
    openReports: Number(proof?.open_reports ?? 0),
    disputed: Boolean(status?.disputed_facts),
    burst: isBurst(counted),
    porkOnMenu: flag("pork_on_menu"),
  });
  const badges = placeBadges({
    certificate: flag("certificate"),
    registryMatch,
    countedVouchers: counted.length,
    creators,
    // Owner claims (place_owners) don't exist yet: nobody earns Muslim owned.
    ownerMuslimOwned: false,
    alcoholOnMenu: flag("alcohol_on_menu"),
    porkOnMenu: flag("pork_on_menu"),
    alcoholSettled: status?.alcohol_settled ?? null,
    porkSettled: status?.pork_settled ?? null,
  });
  return {
    trustScore: trust.score,
    trustBand: trust.band,
    communityVouchers: counted.length,
    creatorCount: creators,
    badges: formatBadges(badges),
    review: trust.review,
    clusters,
  };
}

/** Store computed trust columns. A place without a `place_status` row is left alone. */
export async function writeTrust(placeId: string, trust: PlaceTrustValues, client: Client = database()): Promise<void> {
  const db = await client;
  await db.run(sql`
    UPDATE place_status SET trust_score = ${trust.trustScore}, trust_band = ${trust.trustBand},
      community_vouchers = ${trust.communityVouchers}, creator_count = ${trust.creatorCount}, badges = ${trust.badges}
    WHERE place_id = ${placeId}
  `);
}

/** Recompute and store one place's trust columns. */
export async function recomputeTrust(placeId: string, client: Client = database(), now = Date.now()): Promise<TrustResult> {
  const db = await client;
  const trust = await computeTrust(placeId, db, now);
  await writeTrust(placeId, trust, db);
  return trust;
}
