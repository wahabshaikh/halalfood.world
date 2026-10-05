/** D1 access for coverage levels, city coverage and city requests. */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  summarizeCityCoverage,
  type CityCoverage,
  type CoverageLevel,
} from "@halalfood/core/coverage";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(value ?? 0) || 0;
}

/** Honest coverage counts for one city. */
export async function getCityCoverage(
  citySlug: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<CityCoverage> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT coverage_level, COUNT(*) AS count
    FROM places
    WHERE city_slug = ${citySlug} AND halal_confirmed = 1 AND listing_status = 'listed'
    GROUP BY coverage_level
  `);
  const counts: Partial<Record<CoverageLevel, number>> = {};
  for (const row of rows) {
    const level = String(row.coverage_level ?? "indexed") as CoverageLevel;
    counts[level] = num(row.count);
  }

  const [requestRow] = await db.all<Record<string, unknown>>(sql`
    SELECT COUNT(*) AS requests,
      SUM(CASE WHEN wants_to_contribute = 1 THEN 1 ELSE 0 END) AS contributors
    FROM city_coverage_requests
    WHERE city_slug = ${citySlug}
  `);

  return summarizeCityCoverage(citySlug, counts, {
    requests: num(requestRow?.requests),
    contributors: num(requestRow?.contributors),
  });
}

/** Record a request for deeper coverage. One per requester per city. */
export async function requestCityCoverage(
  input: {
    citySlug: string;
    userId: string | null;
    requesterHash: string;
    wantsToContribute: boolean;
    note: string | null;
  },
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<{ created: boolean }> {
  const db = await client;
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO city_coverage_requests (
      id, city_slug, requested_by_user_id, requester_hash, wants_to_contribute,
      note, created_at
    ) VALUES (
      ${crypto.randomUUID()}, ${input.citySlug}, ${input.userId},
      ${input.requesterHash}, ${input.wantsToContribute ? 1 : 0}, ${input.note},
      ${Date.now()}
    )
    ON CONFLICT(city_slug, requester_hash) DO NOTHING
    RETURNING id
  `);
  return { created: rows.length > 0 };
}

/**
 * Recompute and store one place's coverage level. Called after evidence, a
 * dish or a check-in lands, so the badge tracks what is actually attached.
 */
export async function refreshCoverageLevel(
  placeId: string,
  level: CoverageLevel,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<void> {
  const db = await client;
  // Called on every place page render, so it must be a no-op unless the level
  // actually changed: an unconditional UPDATE is a billed D1 write per view.
  // `coverage_computed_at` therefore records when the level last changed.
  await db.run(sql`
    UPDATE places
    SET coverage_level = ${level}, coverage_computed_at = ${Date.now()}
    WHERE id = ${placeId} AND coverage_level IS NOT ${level}
  `);
}
