/**
 * D1 access for visits, check-ins and dish verdicts.
 *
 * Only derived verification results are written: `verification_method`,
 * `verification_confidence` and a short detail string. Raw coordinates are
 * discarded after `verifyByLocation` runs, and a receipt's bytes stay in R2
 * behind the owner-scoped download route — neither is readable from any
 * public query in this file.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  placeCheckInDishes,
  placeCheckIns,
  placeVisits,
} from "../db/schema";
import {
  normalizeDishName,
  summarizeCheckIns,
  summarizeDishes,
  type CheckInRecord,
  type CheckInSummary,
  type DishHighlights,
  type DishVerdict,
  type DishVerdictRecord,
  type ValidatedCheckIn,
  type ValueVerdict,
  type WouldReturn,
} from "@halalfood/core/check-in";
import { isRelationship, type Relationship } from "@halalfood/core/halal-taxonomy";
import type { VerificationResult } from "@halalfood/core/visit-verification";
import type { PassportVisit } from "@halalfood/core/food-passport";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export type RecordVisitInput = {
  userId: string;
  placeId: string;
  visitedAt: number;
  verification: VerificationResult;
  receiptR2Key: string | null;
  checkIn: ValidatedCheckIn;
};

export type RecordVisitResult = {
  visitId: string;
  verificationMethod: VerificationResult["method"];
  verificationConfidence: VerificationResult["confidence"];
};

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function stringArray(value: unknown): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * One visit plus its check-in and dish verdicts, written atomically. A repeat
 * visit to the same place is a new row by design: revisits are a signal.
 */
export async function recordVisit(
  input: RecordVisitInput,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<RecordVisitResult> {
  const db = await client;
  const visitId = crypto.randomUUID();
  const now = Date.now();
  const { checkIn, verification } = input;

  // D1 rejects SQL `BEGIN`, so `db.transaction()` fails at runtime (error
  // 7500). `db.batch()` is the D1-native equivalent: the statements run in one
  // implicit transaction and the whole batch rolls back if any of them fails,
  // which is what keeps a visit from existing without its check-in.
  await db.batch([
    db.insert(placeVisits).values({
      id: visitId,
      userId: input.userId,
      placeId: input.placeId,
      visitedAt: new Date(input.visitedAt),
      verificationMethod: verification.method,
      verificationConfidence: verification.confidence,
      verificationDetail: verification.detail,
      receiptR2Key: input.receiptR2Key,
      context: checkIn.context,
      visibility: checkIn.visibility,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }),
    db.insert(placeCheckIns).values({
      visitId,
      placeId: input.placeId,
      userId: input.userId,
      wouldReturn: checkIn.wouldReturn,
      wouldBringFriend: checkIn.wouldBringFriend,
      valueVerdict: checkIn.valueVerdict,
      serviceVerdict: checkIn.serviceVerdict,
      spendMinor: checkIn.spendMinor,
      currency: checkIn.currency,
      note: checkIn.note,
      incentivized: checkIn.incentivized,
      relationship: checkIn.relationship,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }),
    ...checkIn.dishes.map((dish) =>
      db.insert(placeCheckInDishes).values({
        id: crypto.randomUUID(),
        visitId,
        placeId: input.placeId,
        dishId: dish.dishId ?? null,
        dishName: dish.name,
        normalizedName: normalizeDishName(dish.name),
        verdict: dish.verdict,
        createdAt: new Date(now),
      }),
    ),
  ] as unknown as Parameters<typeof db.batch>[0]);

  return {
    visitId,
    verificationMethod: verification.method,
    verificationConfidence: verification.confidence,
  };
}

/** Aggregate return intent and value for one place. */
export async function getCheckInSummary(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<CheckInSummary> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      c.would_return,
      c.value_verdict,
      c.service_verdict,
      c.spend_minor,
      c.currency,
      c.incentivized,
      c.relationship,
      v.verification_method,
      v.verification_confidence
    FROM place_check_ins AS c
    INNER JOIN place_visits AS v ON v.id = c.visit_id
    WHERE c.place_id = ${placeId}
    ORDER BY c.created_at DESC
    LIMIT 2000
  `);

  const records: CheckInRecord[] = rows.map((row) => ({
    wouldReturn: row.would_return as WouldReturn,
    valueVerdict: row.value_verdict as ValueVerdict,
    serviceVerdict:
      row.service_verdict === "good" ||
      row.service_verdict === "fine" ||
      row.service_verdict === "poor"
        ? row.service_verdict
        : null,
    spendMinor: num(row.spend_minor),
    currency: typeof row.currency === "string" ? row.currency : null,
    verified:
      row.verification_method !== "none" && row.verification_confidence !== "none",
    incentivized: row.incentivized === 1 || row.incentivized === true,
    relationship: isRelationship(row.relationship)
      ? (row.relationship as Relationship)
      : "none",
  }));

  return summarizeCheckIns(records);
}

/** Dish highlights for one place: most ordered, most recommended, avoided. */
export async function getDishHighlights(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<DishHighlights> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT d.dish_name, d.normalized_name, d.verdict
    FROM place_check_in_dishes AS d
    INNER JOIN place_check_ins AS c ON c.visit_id = d.visit_id
    WHERE d.place_id = ${placeId}
      AND c.incentivized = 0
      AND c.relationship = 'none'
    LIMIT 5000
  `);
  const records: DishVerdictRecord[] = rows.map((row) => ({
    name: String(row.dish_name ?? ""),
    normalizedName: String(row.normalized_name ?? ""),
    verdict: row.verdict as DishVerdict,
  }));
  return summarizeDishes(records);
}

export type PublicCheckIn = {
  visitId: string;
  wouldReturn: WouldReturn;
  valueVerdict: ValueVerdict;
  note: string | null;
  verified: boolean;
  disclosureLabel: string | null;
  createdAt: string;
  authorHandle: string | null;
  dishes: Array<{ name: string; verdict: DishVerdict }>;
};

/** Newest public check-ins for one place, for the profile. */
export async function listPublicCheckIns(
  placeId: string,
  limit = 20,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PublicCheckIn[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      c.visit_id, c.would_return, c.value_verdict, c.note, c.created_at,
      c.incentivized, c.relationship,
      v.verification_method, v.verification_confidence,
      p.handle,
      COALESCE((
        SELECT json_group_array(json_object('name', d.dish_name, 'verdict', d.verdict))
        FROM place_check_in_dishes AS d WHERE d.visit_id = c.visit_id
      ), '[]') AS dishes
    FROM place_check_ins AS c
    INNER JOIN place_visits AS v ON v.id = c.visit_id
    LEFT JOIN user_profiles AS p ON p.user_id = c.user_id
    WHERE c.place_id = ${placeId} AND v.visibility = 'public'
    ORDER BY c.created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 50)}
  `);

  return rows.map((row) => {
    let dishes: Array<{ name: string; verdict: DishVerdict }> = [];
    try {
      const parsed = JSON.parse(String(row.dishes ?? "[]"));
      if (Array.isArray(parsed))
        dishes = parsed.filter(
          (item): item is { name: string; verdict: DishVerdict } =>
            !!item && typeof item.name === "string" && typeof item.verdict === "string",
        );
    } catch {
      dishes = [];
    }
    const incentivized = row.incentivized === 1 || row.incentivized === true;
    const relationship = isRelationship(row.relationship) ? row.relationship : "none";
    return {
      visitId: String(row.visit_id),
      wouldReturn: row.would_return as WouldReturn,
      valueVerdict: row.value_verdict as ValueVerdict,
      note: typeof row.note === "string" ? row.note : null,
      verified:
        row.verification_method !== "none" && row.verification_confidence !== "none",
      disclosureLabel: incentivized
        ? "Rewarded visit — excluded from ranking"
        : relationship !== "none"
          ? "Connected to this restaurant — excluded from ranking"
          : null,
      createdAt: new Date(num(row.created_at) ?? 0).toISOString(),
      authorHandle: typeof row.handle === "string" ? row.handle : null,
      dishes,
    };
  });
}

/** Every place the user has confirmed visiting, for ranked-list validation. */
export async function listVisitedPlaceIds(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<Set<string>> {
  const db = await client;
  const rows = await db.all<{ place_id: string }>(sql`
    SELECT DISTINCT place_id FROM place_visits WHERE user_id = ${userId} LIMIT 5000
  `);
  return new Set(rows.map((row) => row.place_id));
}

/** Visit rows shaped for the food passport. */
export async function listPassportVisits(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PassportVisit[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      v.place_id, v.visited_at, v.verification_method, v.verification_confidence,
      p.city_slug, p.address_country, p.serves_cuisine,
      f.neighbourhood
    FROM place_visits AS v
    INNER JOIN places AS p ON p.id = v.place_id
    LEFT JOIN place_facts AS f ON f.place_id = v.place_id
    WHERE v.user_id = ${userId}
    ORDER BY v.visited_at DESC
    LIMIT 5000
  `);

  return rows.map((row) => ({
    placeId: String(row.place_id),
    citySlug: String(row.city_slug ?? ""),
    neighbourhood: typeof row.neighbourhood === "string" ? row.neighbourhood : null,
    country: typeof row.address_country === "string" ? row.address_country : null,
    cuisines: stringArray(row.serves_cuisine),
    verified:
      row.verification_method !== "none" && row.verification_confidence !== "none",
    visitedAt: num(row.visited_at) ?? 0,
  }));
}

export type VisitedPlaceSummary = {
  placeId: string;
  name: string;
  citySlug: string;
  lat: number | null;
  lng: number | null;
  visits: number;
  lastVisitedAt: number;
  wouldReturn: WouldReturn | null;
};

/** The places behind a personal food map. */
export async function listVisitedPlaces(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<VisitedPlaceSummary[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      v.place_id, p.name, p.city_slug, p.lat, p.lng,
      COUNT(*) AS visits,
      MAX(v.visited_at) AS last_visited_at,
      (
        SELECT c.would_return FROM place_check_ins AS c
        INNER JOIN place_visits AS iv ON iv.id = c.visit_id
        WHERE iv.user_id = v.user_id AND c.place_id = v.place_id
        ORDER BY c.created_at DESC LIMIT 1
      ) AS would_return
    FROM place_visits AS v
    INNER JOIN places AS p ON p.id = v.place_id
    WHERE v.user_id = ${userId} AND v.visibility = 'public'
    GROUP BY v.place_id
    ORDER BY last_visited_at DESC
    LIMIT 1000
  `);

  return rows.map((row) => ({
    placeId: String(row.place_id),
    name: String(row.name ?? ""),
    citySlug: String(row.city_slug ?? ""),
    lat: num(row.lat),
    lng: num(row.lng),
    visits: num(row.visits) ?? 0,
    lastVisitedAt: num(row.last_visited_at) ?? 0,
    wouldReturn:
      row.would_return === "definitely" ||
      row.would_return === "maybe" ||
      row.would_return === "no"
        ? row.would_return
        : null,
  }));
}

/** Has this user already recorded a visit here in the last few hours? */
export async function hasRecentVisit(
  userId: string,
  placeId: string,
  withinMs: number,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    SELECT 1 FROM place_visits
    WHERE user_id = ${userId} AND place_id = ${placeId}
      AND visited_at >= ${Date.now() - withinMs}
    LIMIT 1
  `);
  return rows.length > 0;
}
