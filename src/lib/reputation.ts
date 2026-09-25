/**
 * The contributor reputation ladder.
 *
 * Promotion follows measured accuracy, never contribution volume. A prolific
 * contributor whose submissions keep getting rejected does not advance, and a
 * careful one with fewer, reliably accepted contributions does.
 *
 * This is separate from any public score: the ladder controls *privileges*,
 * and the product still shows no universal reviewer number.
 */

export const CONTRIBUTOR_ROLES = [
  "new",
  "contributor",
  "trusted",
  "city-expert",
  "city-moderator",
] as const;

export type ContributorRole = (typeof CONTRIBUTOR_ROLES)[number];

export type RoleCopy = {
  label: string;
  qualification: string;
  privileges: string;
};

export const ROLE_COPY: Record<ContributorRole, RoleCopy> = {
  new: {
    label: "New contributor",
    qualification: "No verified history yet",
    privileges: "Submissions are reviewed before they publish",
  },
  contributor: {
    label: "Contributor",
    qualification: "Several accepted contributions",
    privileges: "Low-risk facts publish without waiting",
  },
  trusted: {
    label: "Trusted contributor",
    qualification: "High accuracy sustained over time",
    privileges: "Review disputed facts and validate evidence",
  },
  "city-expert": {
    label: "City expert",
    qualification: "Deep local coverage and reliability",
    privileges: "Manage the city queue and guide local launches",
  },
  "city-moderator": {
    label: "City moderator",
    qualification: "Sustained trust and policy knowledge",
    privileges: "Resolve disputes within defined limits",
  },
};

export type Standing = {
  role: ContributorRole;
  accepted: number;
  rejected: number;
  verifiedVisits: number;
  citySlug: string | null;
  restrictedUntil: number | null;
  acceptedSinceRestriction: number;
};

/** Accepted share of all decided contributions; 1 when nothing was decided. */
export function accuracy(standing: Pick<Standing, "accepted" | "rejected">): number {
  const decided = standing.accepted + standing.rejected;
  if (!decided) return 1;
  return standing.accepted / decided;
}

export const ROLE_REQUIREMENTS: Record<
  Exclude<ContributorRole, "new">,
  { accepted: number; accuracy: number; verifiedVisits: number }
> = {
  contributor: { accepted: 3, accuracy: 0.6, verifiedVisits: 0 },
  trusted: { accepted: 15, accuracy: 0.85, verifiedVisits: 3 },
  "city-expert": { accepted: 50, accuracy: 0.9, verifiedVisits: 15 },
  // The top of the ladder is never automatic: resolving disputes is granted by
  // a human, because it carries the power to overrule other contributors.
  "city-moderator": { accepted: Number.POSITIVE_INFINITY, accuracy: 1, verifiedVisits: 0 },
};

export type Promotion = {
  role: ContributorRole;
  changed: boolean;
  reason: string;
};

/**
 * The role an account has earned. A restriction holds the ladder at `new`
 * until it expires and the account has rebuilt a run of accepted work.
 */
export function earnedRole(
  standing: Standing,
  now: number = Date.now(),
): Promotion {
  if (standing.role === "city-moderator")
    return {
      role: "city-moderator",
      changed: false,
      reason: "City moderator is granted by a human and is not recomputed.",
    };

  if (standing.restrictedUntil !== null && standing.restrictedUntil > now)
    return {
      role: "new",
      changed: standing.role !== "new",
      reason: "The account is under a temporary restriction.",
    };

  if (
    standing.restrictedUntil !== null &&
    standing.acceptedSinceRestriction < 5
  )
    return {
      role: "new",
      changed: standing.role !== "new",
      reason: `Rebuilding trust: ${5 - standing.acceptedSinceRestriction} more accepted contributions needed.`,
    };

  const rate = accuracy(standing);
  const ladder: Array<Exclude<ContributorRole, "new" | "city-moderator">> = [
    "city-expert",
    "trusted",
    "contributor",
  ];

  for (const role of ladder) {
    const need = ROLE_REQUIREMENTS[role];
    if (
      standing.accepted >= need.accepted &&
      rate >= need.accuracy &&
      standing.verifiedVisits >= need.verifiedVisits
    )
      return {
        role,
        changed: standing.role !== role,
        reason: `${standing.accepted} accepted contributions at ${Math.round(rate * 100)}% accuracy, with ${standing.verifiedVisits} verified visits.`,
      };
  }

  return {
    role: "new",
    changed: standing.role !== "new",
    reason:
      standing.accepted + standing.rejected === 0
        ? "No contributions decided yet."
        : `${standing.accepted} accepted at ${Math.round(rate * 100)}% accuracy — not enough yet.`,
  };
}

/** Roles allowed to publish a low-risk factual edit without review. */
export function canAutoPublish(role: ContributorRole): boolean {
  return role !== "new";
}

/** Roles allowed to review other people's disputed facts. */
export function canReviewDisputes(role: ContributorRole): boolean {
  return role === "trusted" || role === "city-expert" || role === "city-moderator";
}

/** Roles allowed to resolve a report or an appeal. */
export function canResolveDisputes(role: ContributorRole): boolean {
  return role === "city-moderator";
}
