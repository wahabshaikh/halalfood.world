/**
 * Removing the incentive loop that corrupts conventional public ratings.
 *
 * Four rules live here:
 *
 * 1. No direct review links. A merchant QR code or campaign link may open the
 *    factual profile and nothing else; `safeMerchantTarget` rejects anything
 *    that would land a diner in a feedback form.
 * 2. Incentive disclosure. Rewarded feedback is asked for, recorded, and
 *    excluded from ranking.
 * 3. Merchant relationship disclosure. Owners, staff, agencies, family and paid
 *    creators must declare the relationship; undeclared conflicts are handled
 *    as fraud reports.
 * 4. Weight caps. New accounts, bursts and tightly connected groups cannot move
 *    an aggregate more than a bounded amount.
 */

import type { Relationship } from "./halal-taxonomy";

/** Paths a merchant-controlled link is allowed to open. */
const MERCHANT_SAFE_PATHS = [/^\/place\/[0-9a-f-]{36}$/i, /^\/city\/[a-z0-9-]+$/, /^\/$/];

/** Paths that would start a feedback flow and must never be linked into. */
const FEEDBACK_PATHS = [/\/checkin/i, /\/review/i, /\/rate/i, /\/verify/i];

export type MerchantTargetOutcome =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * A merchant QR code may open the restaurant profile, never a positive-feedback
 * form. Anything outside the factual surfaces is refused.
 */
export function safeMerchantTarget(rawPath: string): MerchantTargetOutcome {
  let path: string;
  try {
    // Relative-only: an absolute URL would let a merchant point off-platform.
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath) || rawPath.startsWith("//"))
      return { ok: false, error: "A merchant link must be a path on this site." };
    path = new URL(rawPath, "https://halalfood.world").pathname;
  } catch {
    return { ok: false, error: "That link is not a valid path." };
  }

  if (FEEDBACK_PATHS.some((pattern) => pattern.test(path)))
    return {
      ok: false,
      error: "A merchant link cannot open a feedback or verification flow.",
    };
  if (!MERCHANT_SAFE_PATHS.some((pattern) => pattern.test(path)))
    return { ok: false, error: "A merchant link may only open a factual profile." };
  return { ok: true, path };
}

export type DisclosureInput = {
  relationship: Relationship;
  incentivized: boolean;
  /** Set when the platform knows the account is connected to the venue. */
  knownAffiliation?: Relationship | null;
};

export type DisclosureOutcome = {
  /** Feedback that is rewarded or from an interested party never ranks. */
  countsTowardsRanking: boolean;
  /** Shown publicly beside the contribution. */
  publicLabel: string | null;
  /** Undisclosed known affiliations are routed to moderation as fraud. */
  requiresReview: boolean;
  reason: string | null;
};

export function evaluateDisclosure(input: DisclosureInput): DisclosureOutcome {
  const undisclosed =
    !!input.knownAffiliation &&
    input.knownAffiliation !== "none" &&
    input.relationship === "none";

  if (undisclosed)
    return {
      countsTowardsRanking: false,
      publicLabel: "Undisclosed connection to this restaurant",
      requiresReview: true,
      reason: "The account is linked to this venue but declared no relationship.",
    };

  if (input.incentivized)
    return {
      countsTowardsRanking: false,
      publicLabel: "Rewarded visit — excluded from ranking",
      requiresReview: false,
      reason: "The diner disclosed that the visit or feedback was rewarded.",
    };

  if (input.relationship !== "none")
    return {
      countsTowardsRanking: false,
      publicLabel: "Connected to this restaurant — excluded from ranking",
      requiresReview: false,
      reason: "A declared relationship with the restaurant excludes this from ranking.",
    };

  return {
    countsTowardsRanking: true,
    publicLabel: null,
    requiresReview: false,
    reason: null,
  };
}

/* ------------------------------------------------------------ weight caps -- */

export const NEW_ACCOUNT_DAYS = 14;
/** No single account may contribute more than this share of one place's signal. */
export const MAX_SHARE_PER_ACCOUNT = 0.25;

export type ContributorWeightInput = {
  accountAgeDays: number;
  acceptedContributions: number;
  rejectedContributions: number;
  /** Submissions by this account for this place in the last 24 hours. */
  recentSubmissionsHere: number;
};

/**
 * A bounded multiplier in [0, 1]. New accounts, rejection history and bursts
 * all reduce it; nothing can push it above 1.
 */
export function contributorWeight(input: ContributorWeightInput): number {
  let weight = 1;
  if (input.accountAgeDays < NEW_ACCOUNT_DAYS)
    weight *= 0.4 + (0.6 * Math.max(input.accountAgeDays, 0)) / NEW_ACCOUNT_DAYS;
  if (input.rejectedContributions > 0) {
    const accuracy =
      input.acceptedContributions /
      (input.acceptedContributions + input.rejectedContributions);
    weight *= Math.max(0.2, accuracy);
  }
  if (input.recentSubmissionsHere > 1)
    weight *= Math.max(0.2, 1 / input.recentSubmissionsHere);
  return Math.min(1, Math.max(0, Number(weight.toFixed(4))));
}

export type BurstSignal = {
  userId: string;
  createdAt: number;
};

export type AnomalyFinding = {
  code: "burst" | "single-account-dominance" | "tight-group";
  message: string;
};

export const BURST_WINDOW_MS = 60 * 60 * 1000;
export const BURST_THRESHOLD = 5;

/**
 * Cheap, explainable anomaly signals over one place's recent contributions.
 * They flag for review; they never silently delete a contribution.
 */
export function detectAnomalies(
  signals: readonly BurstSignal[],
  now: number = Date.now(),
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const recent = signals.filter((signal) => now - signal.createdAt <= BURST_WINDOW_MS);
  if (recent.length >= BURST_THRESHOLD)
    findings.push({
      code: "burst",
      message: `${recent.length} contributions arrived here within an hour.`,
    });

  const byUser = new Map<string, number>();
  for (const signal of signals) byUser.set(signal.userId, (byUser.get(signal.userId) ?? 0) + 1);
  for (const [userId, count] of byUser)
    if (signals.length >= 4 && count / signals.length > MAX_SHARE_PER_ACCOUNT)
      findings.push({
        code: "single-account-dominance",
        message: `One account (${userId.slice(0, 8)}…) submitted ${count} of ${signals.length} contributions here.`,
      });

  if (recent.length >= 3 && new Set(recent.map((signal) => signal.userId)).size <= 2)
    findings.push({
      code: "tight-group",
      message: "A very small group produced all of the recent activity here.",
    });

  return findings;
}

/**
 * Credibility recovers through accurate, verified contributions after a
 * proportionate restriction — it is never a permanent mark.
 */
export function trustRecoveryProgress(input: {
  restrictedUntil: number | null;
  acceptedSinceRestriction: number;
  now?: number;
}): { restricted: boolean; recovered: boolean; remaining: number } {
  const now = input.now ?? Date.now();
  const restricted = input.restrictedUntil !== null && input.restrictedUntil > now;
  const target = 5;
  return {
    restricted,
    recovered: !restricted && input.acceptedSinceRestriction >= target,
    remaining: Math.max(0, target - input.acceptedSinceRestriction),
  };
}
