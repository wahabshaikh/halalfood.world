/** D1 access for coverage levels, city coverage and city requests. */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  cityDemandScore,
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
    WHERE city_slug = ${citySlug} AND halal_confirmed = 1
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

export type CityDemandRow = CityCoverage & { demandScore: number };

/** Cities ordered by where enrichment spend would go furthest. */
export async function listCityDemand(
  limit = 50,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<CityDemandRow[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      p.city_slug,
      SUM(CASE WHEN p.coverage_level = 'indexed' THEN 1 ELSE 0 END) AS indexed,
      SUM(CASE WHEN p.coverage_level = 'enriched' THEN 1 ELSE 0 END) AS enriched,
      SUM(CASE WHEN p.coverage_level = 'intelligent' THEN 1 ELSE 0 END) AS intelligent,
      SUM(CASE WHEN p.coverage_level = 'trusted' THEN 1 ELSE 0 END) AS trusted,
      (SELECT COUNT(*) FROM city_coverage_requests AS r WHERE r.city_slug = p.city_slug)
        AS requests,
      (SELECT COUNT(*) FROM city_coverage_requests AS r
        WHERE r.city_slug = p.city_slug AND r.wants_to_contribute = 1) AS contributors
    FROM places AS p
    WHERE p.halal_confirmed = 1
    GROUP BY p.city_slug
    ORDER BY requests DESC, COUNT(*) DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `);

  return rows.map((row) => {
    const coverage = summarizeCityCoverage(
      String(row.city_slug ?? ""),
      {
        indexed: num(row.indexed),
        enriched: num(row.enriched),
        intelligent: num(row.intelligent),
        trusted: num(row.trusted),
      },
      { requests: num(row.requests), contributors: num(row.contributors) },
    );
    return {
      ...coverage,
      demandScore: cityDemandScore({
        requests: coverage.requests,
        // Search and view counts are not instrumented yet; the score is built
        // so those terms can be filled in without changing its shape.
        searches: 0,
        placeViews: 0,
        contributors: coverage.contributors,
        enrichedPercent: coverage.enrichedPercent,
      }),
    };
  });
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
  await db.run(sql`
    UPDATE places
    SET coverage_level = ${level}, coverage_computed_at = ${Date.now()}
    WHERE id = ${placeId}
  `);
}
