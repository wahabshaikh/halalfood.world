/**
 * The decision summary: everything the profile needs to answer, in order,
 * "can I eat here?", "why should I trust that?", "is the food worth eating?".
 *
 * It composes the independent pieces rather than fusing them — the halal
 * assessment, the separate factual attributes, the return-intent aggregate and
 * the dish highlights each keep their own counts, dates and insufficient-data
 * states.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  deriveHalalAssessment,
  formatEvidenceAge,
  STATUS_COPY,
  type HalalAssessment,
} from "./halal-taxonomy";
import { listApprovedEvidenceRecords } from "./halal-verifications";
import {
  emptyFacts,
  mapPlaceFacts,
  priceBandLabel,
  type PlaceFacts,
} from "./place-facts";
import { getCheckInSummary, getDishHighlights } from "./visits";
import type { CheckInSummary, DishHighlights } from "./check-in";
import {
  evaluateSuitability,
  type Suitability,
  type UserPreferences,
} from "./user-preferences";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/** Fallbacks that read as "nothing recorded", never as "nothing here is good". */
const EMPTY_CHECK_IN_SUMMARY: CheckInSummary = {
  verified: {
    count: 0,
    wouldReturnPercent: null,
    definitely: 0,
    maybe: 0,
    no: 0,
    insufficientData: true,
  },
  unverified: {
    count: 0,
    wouldReturnPercent: null,
    definitely: 0,
    maybe: 0,
    no: 0,
    insufficientData: true,
  },
  excludedCount: 0,
  value: { great: 0, fair: 0, overpriced: 0 },
  service: { good: 0, fine: 0, poor: 0, rated: 0 },
  medianSpendMinor: null,
  currency: null,
};

const EMPTY_DISH_HIGHLIGHTS: DishHighlights = {
  mostOrdered: [],
  mostRecommended: [],
  commonlyAvoided: [],
  insufficientData: true,
};

export type DecisionSummary = {
  placeId: string;
  assessment: HalalAssessment;
  facts: PlaceFacts;
  checkIns: CheckInSummary;
  dishes: DishHighlights;
  /** Present only for a signed-in user with saved dietary standards. */
  suitability: Suitability | null;
  /** One line stating the headline, safe to render without any other context. */
  headline: string;
  /** The evidence date and scope line that must sit beside a strong claim. */
  evidenceLine: string;
  priceLabel: string | null;
};

export async function getPlaceFacts(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PlaceFacts> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT * FROM place_facts WHERE place_id = ${placeId} LIMIT 1
  `);
  return mapPlaceFacts(placeId, rows[0] ?? null);
}

/** The status line, written so it is never mistaken for a religious ruling. */
export function buildHeadline(assessment: HalalAssessment): string {
  const copy = STATUS_COPY[assessment.status];
  if (assessment.conflict)
    return "Unverified — the current evidence here conflicts and is under review.";
  if (assessment.status === "unverified" && assessment.evidenceCount === 0)
    return "Unverified — no evidence yet. That is not the same as not halal.";
  return `${copy.label} — ${copy.summary}`;
}

/** Evidence date and scope always travel together with a strong claim. */
export function buildEvidenceLine(
  assessment: HalalAssessment,
  now: number = Date.now(),
): string {
  if (!assessment.evidenceCount) return "No evidence on file for this branch.";
  const parts: string[] = [];
  parts.push(
    `${assessment.currentEvidenceCount} current ${assessment.currentEvidenceCount === 1 ? "item" : "items"} from ${assessment.contributorCount} ${assessment.contributorCount === 1 ? "contributor" : "contributors"}`,
  );
  if (assessment.latestEvidenceAt !== null)
    parts.push(`newest ${formatEvidenceAge(assessment.latestEvidenceAt, now)}`);
  if (assessment.scope) {
    const scopeCopy: Record<string, string> = {
      venue: "covering the whole venue",
      "meat-only": "covering meat only",
      "selected-dishes": "covering selected dishes",
      branch: "covering this branch only",
      "delivery-kitchen": "covering the delivery kitchen",
      "time-period": "covering a stated time period",
    };
    parts.push(scopeCopy[assessment.scope] ?? `scope: ${assessment.scope}`);
  }
  if (assessment.staleEvidenceCount)
    parts.push(`${assessment.staleEvidenceCount} expired`);
  return parts.join(" · ");
}

export async function getDecisionSummary(
  placeId: string,
  preferences: UserPreferences | null = null,
  now: number = Date.now(),
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<DecisionSummary> {
  // The halal status is the page's core promise, so it does not share a
  // failure with anything else: each read settles on its own and falls back to
  // an empty result. A check-in query that fails — for instance against a
  // database where 0010 has not been applied and `service_verdict` is missing
  // — must not take the status, the evidence and the facts down with it.
  const settle = async <T,>(
    label: string,
    read: () => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      console.error(`decision.${label} failed`, placeId, error);
      return fallback;
    }
  };

  const [evidence, facts, checkIns, dishes] = await Promise.all([
    settle("evidence", () => listApprovedEvidenceRecords(placeId, client), []),
    settle("facts", () => getPlaceFacts(placeId, client), emptyFacts(placeId)),
    settle("check-ins", () => getCheckInSummary(placeId, client), EMPTY_CHECK_IN_SUMMARY),
    settle("dishes", () => getDishHighlights(placeId, client), EMPTY_DISH_HIGHLIGHTS),
  ]);

  const assessment = deriveHalalAssessment(evidence, now);

  return {
    placeId,
    assessment,
    facts,
    checkIns,
    dishes,
    suitability: preferences
      ? evaluateSuitability(preferences, assessment, facts, now)
      : null,
    headline: buildHeadline(assessment),
    evidenceLine: buildEvidenceLine(assessment, now),
    priceLabel: priceBandLabel(facts.priceBand),
  };
}

/** Prior statuses and the evidence that caused each change. */
export type StatusChange = {
  id: string;
  previousStatus: string | null;
  nextStatus: string;
  previousConfidence: string | null;
  nextConfidence: string;
  reason: string | null;
  createdAt: number;
};

export async function listStatusHistory(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<StatusChange[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, previous_status, next_status, previous_confidence, next_confidence,
      reason, created_at
    FROM place_halal_status_history
    WHERE place_id = ${placeId}
    ORDER BY created_at DESC
    LIMIT 50
  `);
  return rows.map((row) => ({
    id: String(row.id),
    previousStatus:
      typeof row.previous_status === "string" ? row.previous_status : null,
    nextStatus: String(row.next_status ?? "unverified"),
    previousConfidence:
      typeof row.previous_confidence === "string" ? row.previous_confidence : null,
    nextConfidence: String(row.next_confidence ?? "none"),
    reason: typeof row.reason === "string" ? row.reason : null,
    createdAt: Number(row.created_at ?? 0),
  }));
}

/**
 * Record a status transition when derivation produces a different outcome than
 * last time. Called after evidence is approved, rejected or superseded.
 */
export async function recordStatusChange(
  placeId: string,
  next: HalalAssessment,
  options: { verificationId?: string | null; reason?: string | null } = {},
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  const [previous] = await listStatusHistory(placeId, client);
  if (
    previous &&
    previous.nextStatus === next.status &&
    previous.nextConfidence === next.confidence
  )
    return false;

  await db.run(sql`
    INSERT INTO place_halal_status_history (
      id, place_id, previous_status, next_status, previous_confidence,
      next_confidence, verification_id, reason, created_at
    ) VALUES (
      ${crypto.randomUUID()}, ${placeId}, ${previous?.nextStatus ?? null},
      ${next.status}, ${previous?.nextConfidence ?? null}, ${next.confidence},
      ${options.verificationId ?? null},
      ${options.reason ?? next.reasons[0] ?? null}, ${Date.now()}
    )
  `);
  return true;
}
