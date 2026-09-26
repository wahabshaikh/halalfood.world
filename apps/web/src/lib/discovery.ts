/**
 * Filtered, trust-aware place search.
 *
 * The status a place is filtered and sorted by is derived from its approved,
 * unexpired evidence — the same rule `deriveHalalAssessment` applies on a
 * profile — computed in SQL so the map can filter a whole viewport in one
 * query. `evidenceRankSql` and the derivation must agree; the unit tests pin
 * the pieces that matter (kind ceilings, expiry, interested parties).
 */

import { sql, type SQL } from "drizzle-orm";
import { database } from "../db";
import {
  FACT_FILTER_SQL,
  type DiscoveryFilters,
} from "@halalfood/core/discovery-filters";
import type { HalalTaxonomyStatus } from "@halalfood/core/halal-taxonomy";
import type { Place } from "./places";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export type DiscoveredPlace = Place & {
  halal_status: HalalTaxonomyStatus;
  evidence_count: number;
  latest_evidence_at: number | null;
  would_return_percent: number | null;
  check_in_count: number;
  verified_check_in_count: number;
  price_band: number | null;
  neighbourhood: string | null;
  distance_km: number | null;
};

/**
 * Per-place evidence aggregate, restricted to approved and unexpired rows.
 * `strength` mirrors the kind ceilings in halal-taxonomy.ts. Both aggregates
 * read only the `candidates` CTE's places, so a query costs rows in the
 * requested area rather than every verification and check-in ever written.
 */
const EVIDENCE_AGGREGATE = sql`
  SELECT
    v.place_id AS place_id,
    COUNT(*) AS evidence_count,
    COUNT(DISTINCT v.submitted_by_user_id) AS contributor_count,
    MAX(v.captured_at) AS latest_evidence_at,
    MAX(
      CASE
        WHEN v.claimed_status = 'not-halal' THEN 0
        WHEN v.incentivized = 1 OR v.relationship <> 'none' THEN 2
        WHEN v.evidence_kind IN ('certification', 'supplier-invoice')
             AND v.claimed_status = 'verified'
             AND (v.evidence_kind <> 'certification' OR v.certification_body IS NOT NULL)
          THEN 5
        WHEN v.evidence_kind IN ('packaging', 'menu-photo', 'first-hand')
             AND v.claimed_status IN ('verified', 'community-verified')
          THEN 4
        WHEN v.claimed_status = 'halal-options' THEN 3
        ELSE 2
      END
    ) AS strength,
    SUM(CASE WHEN v.claimed_status = 'not-halal' THEN 1 ELSE 0 END) AS negative_count,
    SUM(CASE WHEN v.claimed_status <> 'not-halal' THEN 1 ELSE 0 END) AS positive_count,
    COUNT(DISTINCT CASE
      WHEN v.claimed_status IN ('verified', 'community-verified')
        AND v.incentivized = 0 AND v.relationship = 'none'
      THEN v.submitted_by_user_id END) AS community_contributors
  FROM place_halal_verifications AS v
  WHERE v.place_id IN (SELECT id FROM candidates)
    AND v.status = 'approved'
    AND v.superseded_by_id IS NULL
    AND COALESCE(v.expires_at, v.created_at + 15552000000) > unixepoch('subsec') * 1000
  GROUP BY v.place_id
`;

/**
 * Collapse the aggregate to one taxonomy status. Conflicting current evidence
 * is Unverified, never Not halal — absence and contradiction are different
 * things from proof.
 */
const STATUS_EXPRESSION = sql`
  CASE
    WHEN e.place_id IS NULL THEN 'unverified'
    WHEN e.negative_count > 0 AND e.positive_count > 0 THEN 'unverified'
    WHEN e.negative_count > 0 THEN 'not-halal'
    WHEN e.strength >= 5 THEN 'verified'
    WHEN e.strength >= 4 AND e.community_contributors >= 2 THEN 'community-verified'
    WHEN e.strength >= 3 THEN 'halal-options'
    ELSE 'self-declared'
  END
`;

const CHECK_IN_AGGREGATE = sql`
  SELECT
    c.place_id AS place_id,
    COUNT(*) AS check_in_count,
    SUM(CASE WHEN v.verification_method <> 'none'
              AND v.verification_confidence <> 'none' THEN 1 ELSE 0 END)
      AS verified_check_in_count,
    SUM(CASE WHEN c.would_return = 'definitely' THEN 1 ELSE 0 END) AS definitely_count
  FROM place_check_ins AS c
  INNER JOIN place_visits AS v ON v.id = c.visit_id
  WHERE c.place_id IN (SELECT id FROM candidates)
    AND c.incentivized = 0 AND c.relationship = 'none'
  GROUP BY c.place_id
`;

/** Below five check-ins the product publishes counts, never a percentage. */
const WOULD_RETURN_EXPRESSION = sql`
  CASE WHEN COALESCE(k.check_in_count, 0) >= 5
    THEN CAST(ROUND(k.definitely_count * 100.0 / k.check_in_count) AS INTEGER)
    ELSE NULL END
`;

/**
 * Great-circle distance in km, as a SQL expression.
 *
 * The squares are written out rather than calling POWER(): D1's SQLite build
 * ships ASIN, RADIANS, SIN, COS and SQRT but not POWER, so a POWER() call makes
 * the whole query fail at runtime.
 */
function distanceExpression(origin: { lat: number; lng: number }): SQL {
  return sql`(
    6371 * 2 * ASIN(MIN(1, SQRT(
      (SIN(RADIANS(p.lat - ${origin.lat}) / 2) * SIN(RADIANS(p.lat - ${origin.lat}) / 2)) +
      COS(RADIANS(${origin.lat})) * COS(RADIANS(p.lat)) *
      (SIN(RADIANS(p.lng - ${origin.lng}) / 2) * SIN(RADIANS(p.lng - ${origin.lng}) / 2))
    )))
  )`;
}

export type DiscoveryQuery = {
  filters: DiscoveryFilters;
  bbox?: { west: number; south: number; east: number; north: number };
  citySlug?: string;
  origin?: { lat: number; lng: number } | null;
  limit: number;
  offset?: number;
};

/**
 * Conditions on `places` alone. They form the `candidates` CTE, so they must
 * stay index-friendly: the lat/lng box uses `places_listed_lat_lng_idx` and a
 * city uses the city-leading unique index.
 */
function buildPlaceConditions(query: DiscoveryQuery): SQL[] {
  const conditions: SQL[] = [
    sql`halal_confirmed = 1 AND lat IS NOT NULL AND lng IS NOT NULL`,
  ];

  if (query.bbox) {
    const { west, south, east, north } = query.bbox;
    conditions.push(sql`lat BETWEEN ${south} AND ${north}`);
    conditions.push(
      west <= east
        ? sql`lng BETWEEN ${west} AND ${east}`
        : sql`(lng >= ${west} OR lng <= ${east})`,
    );
  }
  if (query.citySlug) conditions.push(sql`city_slug = ${query.citySlug}`);
  return conditions;
}

/** Everything else: filters that need facts, evidence or check-in joins. */
function buildConditions(query: DiscoveryQuery): SQL[] {
  const { filters } = query;
  const conditions: SQL[] = [sql`1 = 1`];

  if (filters.q) {
    const term = "%" + filters.q.replace(/[\\%_]/g, "\\$&") + "%";
    conditions.push(sql`(
      p.name LIKE ${term} ESCAPE '\\'
      OR replace(p.city_slug, '-', ' ') LIKE ${term} ESCAPE '\\'
      OR p.street_address LIKE ${term} ESCAPE '\\'
      OR p.address_locality LIKE ${term} ESCAPE '\\'
      OR p.serves_cuisine LIKE ${term} ESCAPE '\\'
      OR f.neighbourhood LIKE ${term} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM place_dishes AS sd
        WHERE sd.place_id = p.id AND sd.status = 'accepted'
          AND sd.name LIKE ${term} ESCAPE '\\'
      )
    )`);
  }

  if (filters.dish) {
    const dishTerm = "%" + filters.dish.replace(/[\\%_]/g, "\\$&") + "%";
    conditions.push(sql`EXISTS (
      SELECT 1 FROM place_dishes AS d
      WHERE d.place_id = p.id AND d.status = 'accepted' AND d.name LIKE ${dishTerm} ESCAPE '\\'
      UNION ALL
      SELECT 1 FROM place_check_in_dishes AS cd
      WHERE cd.place_id = p.id AND cd.dish_name LIKE ${dishTerm} ESCAPE '\\'
    )`);
  }

  if (filters.statuses.length)
    conditions.push(
      sql`${STATUS_EXPRESSION} IN (${sql.join(
        filters.statuses.map((status) => sql`${status}`),
        sql`, `,
      )})`,
    );

  for (const key of filters.facts) {
    if (key === "certified") {
      conditions.push(sql`f.certification_body IS NOT NULL`);
      continue;
    }
    const rule = FACT_FILTER_SQL[key];
    conditions.push(
      sql`${sql.raw(`f.${rule.column}`)} = ${rule.equals}`,
    );
  }

  if (filters.cuisines.length)
    conditions.push(
      sql`(${sql.join(
        filters.cuisines.map(
          (cuisine) =>
            sql`LOWER(p.serves_cuisine) LIKE ${"%" + cuisine.replace(/[\\%_]/g, "\\$&") + "%"} ESCAPE '\\'`,
        ),
        sql` OR `,
      )})`,
    );

  if (filters.priceBands.length)
    conditions.push(
      sql`f.price_band IN (${sql.join(
        filters.priceBands.map((band) => sql`${band}`),
        sql`, `,
      )})`,
    );

  for (const service of filters.serviceTypes)
    conditions.push(
      sql`LOWER(f.service_types) LIKE ${`%"${service}"%`}`,
    );
  for (const meal of filters.meals)
    conditions.push(sql`LOWER(f.meals) LIKE ${`%"${meal}"%`}`);

  if (filters.maxDistanceKm !== null && query.origin)
    conditions.push(
      sql`${distanceExpression(query.origin)} <= ${filters.maxDistanceKm}`,
    );

  return conditions;
}

function buildOrder(query: DiscoveryQuery): SQL {
  const distance = query.origin ? distanceExpression(query.origin) : null;
  switch (query.filters.sort) {
    case "would-return":
      return sql`COALESCE(k.check_in_count, 0) >= 5 DESC, ${WOULD_RETURN_EXPRESSION} DESC NULLS LAST, k.check_in_count DESC NULLS LAST, p.id`;
    case "evidence":
      return sql`COALESCE(e.strength, 0) DESC, COALESCE(e.contributor_count, 0) DESC, p.id`;
    case "distance":
      return distance
        ? sql`${distance} ASC, p.id`
        : sql`p.name COLLATE NOCASE ASC, p.id`;
    case "recent":
      return sql`e.latest_evidence_at DESC NULLS LAST, p.id`;
    case "value":
      return sql`(
        SELECT SUM(CASE WHEN c.value_verdict = 'great' THEN 1 ELSE 0 END)
        FROM place_check_ins AS c WHERE c.place_id = p.id
      ) DESC NULLS LAST, p.id`;
    default:
      // Recommended: suitability first, then evidence strength, then real
      // dining signal, then proximity. Never a paid or sponsored position.
      return sql`
        CASE WHEN ${STATUS_EXPRESSION} = 'not-halal' THEN 1 ELSE 0 END ASC,
        COALESCE(e.strength, 0) DESC,
        COALESCE(k.verified_check_in_count, 0) DESC,
        COALESCE(e.evidence_count, 0) DESC,
        ${distance ? sql`${distance} ASC,` : sql``}
        p.id`;
  }
}

export type DiscoveryResult = {
  places: DiscoveredPlace[];
  total: number;
  limit: number;
  offset: number;
};

export async function discoverPlaces(
  query: DiscoveryQuery,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<DiscoveryResult> {
  const db = await client;
  const limit = Math.min(Math.max(Math.trunc(query.limit) || 60, 1), 600);
  const offset = Math.min(Math.max(Math.trunc(query.offset ?? 0), 0), 100000);
  const conditions = buildConditions(query);
  const distance = query.origin ? distanceExpression(query.origin) : sql`NULL`;

  const rows = await db.all<Record<string, unknown>>(sql`
    WITH candidates AS (
      SELECT id, name, city_slug, street_address, address_locality,
        address_country, telephone, website, rating_value, review_count,
        lat, lng, serves_cuisine
      FROM places
      WHERE ${sql.join(buildPlaceConditions(query), sql` AND `)}
    )
    SELECT
      p.id, p.name, p.city_slug, p.street_address, p.address_locality,
      p.address_country, p.telephone, p.website, p.rating_value, p.review_count,
      p.lat, p.lng,
      ${STATUS_EXPRESSION} AS halal_status,
      COALESCE(e.evidence_count, 0) AS evidence_count,
      e.latest_evidence_at AS latest_evidence_at,
      ${WOULD_RETURN_EXPRESSION} AS would_return_percent,
      COALESCE(k.check_in_count, 0) AS check_in_count,
      COALESCE(k.verified_check_in_count, 0) AS verified_check_in_count,
      f.price_band AS price_band,
      f.neighbourhood AS neighbourhood,
      ${distance} AS distance_km,
      count(*) OVER() AS total
    FROM candidates AS p
    LEFT JOIN place_facts AS f ON f.place_id = p.id
    LEFT JOIN (${EVIDENCE_AGGREGATE}) AS e ON e.place_id = p.id
    LEFT JOIN (${CHECK_IN_AGGREGATE}) AS k ON k.place_id = p.id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${buildOrder(query)}
    LIMIT ${limit} OFFSET ${offset}
  `);

  const number = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : null;

  return {
    places: rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      city_slug: String(row.city_slug ?? ""),
      street_address: String(row.street_address ?? ""),
      address_locality:
        typeof row.address_locality === "string" ? row.address_locality : null,
      address_country:
        typeof row.address_country === "string" ? row.address_country : null,
      telephone: typeof row.telephone === "string" ? row.telephone : null,
      website: typeof row.website === "string" ? row.website : null,
      rating_value: typeof row.rating_value === "string" ? row.rating_value : null,
      review_count: number(row.review_count),
      lat: number(row.lat) ?? 0,
      lng: number(row.lng) ?? 0,
      halal_status: (row.halal_status ?? "unverified") as HalalTaxonomyStatus,
      evidence_count: number(row.evidence_count) ?? 0,
      latest_evidence_at: number(row.latest_evidence_at),
      would_return_percent: number(row.would_return_percent),
      check_in_count: number(row.check_in_count) ?? 0,
      verified_check_in_count: number(row.verified_check_in_count) ?? 0,
      price_band: number(row.price_band),
      neighbourhood: typeof row.neighbourhood === "string" ? row.neighbourhood : null,
      distance_km: number(row.distance_km),
    })),
    total: number(rows[0]?.total) ?? 0,
    limit,
    offset,
  };
}
