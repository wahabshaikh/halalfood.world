/** D1 access for contributor standing and the reputation ladder. */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  earnedRole,
  type ContributorRole,
  type Standing,
} from "./reputation";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(value ?? 0) || 0;
}

const EMPTY: Standing = {
  role: "new",
  accepted: 0,
  rejected: 0,
  verifiedVisits: 0,
  citySlug: null,
  restrictedUntil: null,
  acceptedSinceRestriction: 0,
};

export async function getStanding(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<Standing> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT role, city_slug, accepted_count, rejected_count, verified_visits,
      restricted_until, accepted_since_restriction
    FROM contributor_standing WHERE user_id = ${userId} LIMIT 1
  `);
  const row = rows[0];
  if (!row) return { ...EMPTY };
  return {
    role: (row.role as ContributorRole) ?? "new",
    accepted: num(row.accepted_count),
    rejected: num(row.rejected_count),
    verifiedVisits: num(row.verified_visits),
    citySlug: typeof row.city_slug === "string" ? row.city_slug : null,
    restrictedUntil:
      row.restricted_until === null || row.restricted_until === undefined
        ? null
        : num(row.restricted_until),
    acceptedSinceRestriction: num(row.accepted_since_restriction),
  };
}

/**
 * Recount a contributor's record from the contributions themselves and store
 * the role they have earned.
 *
 * Counting from source rather than incrementing a cached total means a
 * reversed decision actually costs the contributor their standing, which is
 * what makes the ladder accuracy-based rather than volume-based.
 */
export async function refreshStanding(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<{ role: ContributorRole; changed: boolean; reason: string }> {
  const db = await client;

  const [counts] = await db.all<Record<string, unknown>>(sql`
    SELECT
      (SELECT COUNT(*) FROM place_edit_suggestions
        WHERE submitted_by_user_id = ${userId} AND status = 'accepted')
      + (SELECT COUNT(*) FROM place_halal_verifications
        WHERE submitted_by_user_id = ${userId} AND status = 'approved') AS accepted,
      (SELECT COUNT(*) FROM place_edit_suggestions
        WHERE submitted_by_user_id = ${userId} AND status = 'rejected')
      + (SELECT COUNT(*) FROM place_halal_verifications
        WHERE submitted_by_user_id = ${userId} AND status = 'rejected') AS rejected,
      (SELECT COUNT(*) FROM place_visits
        WHERE user_id = ${userId}
          AND verification_method <> 'none'
          AND verification_confidence <> 'none') AS verified_visits
  `);

  const current = await getStanding(userId, client);
  const standing: Standing = {
    ...current,
    accepted: num(counts?.accepted),
    rejected: num(counts?.rejected),
    verifiedVisits: num(counts?.verified_visits),
  };

  const promotion = earnedRole(standing);
  const now = Date.now();

  await db.run(sql`
    INSERT INTO contributor_standing (
      user_id, role, city_slug, accepted_count, rejected_count, verified_visits,
      restricted_until, accepted_since_restriction, founding_contributor_city,
      promoted_at, promoted_reason, created_at, updated_at
    ) VALUES (
      ${userId}, ${promotion.role}, ${standing.citySlug}, ${standing.accepted},
      ${standing.rejected}, ${standing.verifiedVisits}, ${standing.restrictedUntil},
      ${standing.acceptedSinceRestriction}, NULL,
      ${promotion.changed ? now : null}, ${promotion.reason}, ${now}, ${now}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      role = excluded.role,
      accepted_count = excluded.accepted_count,
      rejected_count = excluded.rejected_count,
      verified_visits = excluded.verified_visits,
      promoted_at = CASE WHEN ${promotion.changed ? 1 : 0} = 1
        THEN excluded.promoted_at ELSE contributor_standing.promoted_at END,
      promoted_reason = excluded.promoted_reason,
      updated_at = excluded.updated_at
  `);

  return promotion;
}

/** Everyone standing at trusted or above in one city. */
export async function listCityExperts(
  citySlug: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
) {
  const db = await client;
  return db.all<Record<string, unknown>>(sql`
    SELECT s.user_id, s.role, s.accepted_count, s.verified_visits, p.handle
    FROM contributor_standing AS s
    LEFT JOIN user_profiles AS p ON p.user_id = s.user_id
    WHERE s.city_slug = ${citySlug}
      AND s.role IN ('trusted', 'city-expert', 'city-moderator')
    ORDER BY s.accepted_count DESC
    LIMIT 50
  `);
}
