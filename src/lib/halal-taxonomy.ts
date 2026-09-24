/**
 * The halal taxonomy and the derivation that turns evidence into a public
 * status.
 *
 * Product rules this file encodes, in the order they are applied:
 *
 * 1. Facts before labels. The derivation returns the evidence counts, scopes,
 *    dates and conflicts alongside the status so the UI never has to reduce a
 *    claim to one opaque badge.
 * 2. Unknown is not non-halal. Missing, stale, ambiguous or conflicting
 *    evidence yields `unverified`. `not-halal` is only ever returned when
 *    current evidence positively contradicts a halal claim.
 * 3. Evidence expires. Every item carries an effective expiry, either explicit
 *    or derived from its kind, and stale items never support a status.
 * 4. Conflicts block confidence. Contradictory current evidence prevents any
 *    high-confidence badge until a moderator resolves it.
 * 5. Interested parties cannot self-verify. Evidence from an owner, employee,
 *    agency, family member or compensated creator — or any incentivized
 *    submission — can support `self-declared` at most.
 *
 * Branch safety: this function is deliberately per-place. Each branch is its
 * own `places` row, so evidence for one location can never be derived into a
 * status for another.
 */

export const HALAL_STATUSES = [
  "verified",
  "community-verified",
  "halal-options",
  "self-declared",
  "unverified",
  "not-halal",
] as const;

export type HalalTaxonomyStatus = (typeof HALAL_STATUSES)[number];

export const EVIDENCE_KINDS = [
  "certification",
  "supplier-invoice",
  "packaging",
  "menu-photo",
  "official-website",
  "restaurant-statement",
  "first-hand",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_SCOPES = [
  "venue",
  "meat-only",
  "selected-dishes",
  "branch",
  "delivery-kitchen",
  "time-period",
] as const;

export type EvidenceScope = (typeof EVIDENCE_SCOPES)[number];

export const RELATIONSHIPS = [
  "none",
  "owner",
  "staff",
  "agency",
  "family",
  "paid-creator",
] as const;

export type Relationship = (typeof RELATIONSHIPS)[number];

export type Confidence = "high" | "medium" | "low" | "none";

const DAY_MS = 86_400_000;

/**
 * Expiry is set per evidence type and risk, never one global duration. A
 * certificate carries its own printed expiry far more often than a diner's
 * first-hand check does, so the fallbacks below only apply when a submission
 * did not declare one.
 */
export const DEFAULT_EVIDENCE_TTL_DAYS: Record<EvidenceKind, number> = {
  certification: 365,
  "supplier-invoice": 180,
  packaging: 180,
  "menu-photo": 365,
  "official-website": 180,
  "restaurant-statement": 270,
  "first-hand": 180,
};

/** The strongest status each evidence kind is allowed to support on its own. */
const KIND_CEILING: Record<EvidenceKind, HalalTaxonomyStatus> = {
  certification: "verified",
  "supplier-invoice": "verified",
  packaging: "community-verified",
  "menu-photo": "community-verified",
  "first-hand": "community-verified",
  "official-website": "self-declared",
  "restaurant-statement": "self-declared",
};

/** Higher is stronger. `not-halal` is outside this ordering by design. */
const POSITIVE_RANK: Record<Exclude<HalalTaxonomyStatus, "not-halal">, number> = {
  verified: 5,
  "community-verified": 4,
  "halal-options": 3,
  "self-declared": 2,
  unverified: 1,
};

export function isHalalTaxonomyStatus(
  value: unknown,
): value is HalalTaxonomyStatus {
  return (
    typeof value === "string" &&
    (HALAL_STATUSES as readonly string[]).includes(value)
  );
}

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return (
    typeof value === "string" &&
    (EVIDENCE_KINDS as readonly string[]).includes(value)
  );
}

export function isEvidenceScope(value: unknown): value is EvidenceScope {
  return (
    typeof value === "string" &&
    (EVIDENCE_SCOPES as readonly string[]).includes(value)
  );
}

export function isRelationship(value: unknown): value is Relationship {
  return (
    typeof value === "string" &&
    (RELATIONSHIPS as readonly string[]).includes(value)
  );
}

export function statusRank(status: HalalTaxonomyStatus): number {
  return status === "not-halal" ? 0 : POSITIVE_RANK[status];
}

/** Compare two minimum-status thresholds; used by dietary standards. */
export function meetsMinimumStatus(
  status: HalalTaxonomyStatus,
  minimum: Exclude<HalalTaxonomyStatus, "not-halal">,
): boolean {
  if (status === "not-halal") return false;
  return POSITIVE_RANK[status] >= POSITIVE_RANK[minimum];
}

export type EvidenceRecord = {
  id: string;
  kind: EvidenceKind;
  /** What the submitter says the evidence shows. */
  claimedStatus: HalalTaxonomyStatus;
  scope: EvidenceScope;
  scopeNote?: string | null;
  capturedAt: number;
  expiresAt?: number | null;
  submittedByUserId: string;
  relationship: Relationship;
  incentivized: boolean;
  certificationBody?: string | null;
};

export type AssessedEvidence = EvidenceRecord & {
  effectiveExpiresAt: number;
  current: boolean;
  /** Strongest status this one item is allowed to support. */
  supports: HalalTaxonomyStatus;
  /** True when the submitter has a declared stake in the restaurant. */
  interested: boolean;
};

export type HalalConflict = {
  positiveEvidenceIds: string[];
  negativeEvidenceIds: string[];
};

export type HalalAssessment = {
  status: HalalTaxonomyStatus;
  confidence: Confidence;
  /** Every approved item, current or not. */
  evidenceCount: number;
  currentEvidenceCount: number;
  staleEvidenceCount: number;
  contributorCount: number;
  scope: EvidenceScope | null;
  scopes: EvidenceScope[];
  latestEvidenceAt: number | null;
  earliestExpiryAt: number | null;
  needsReverification: boolean;
  conflict: HalalConflict | null;
  /** Plain-language reasons, shown verbatim in the evidence panel. */
  reasons: string[];
};

export function effectiveExpiry(item: EvidenceRecord): number {
  if (typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt))
    return item.expiresAt;
  return item.capturedAt + DEFAULT_EVIDENCE_TTL_DAYS[item.kind] * DAY_MS;
}

function interestedParty(item: EvidenceRecord): boolean {
  return item.incentivized || item.relationship !== "none";
}

function weakest(
  a: Exclude<HalalTaxonomyStatus, "not-halal">,
  b: Exclude<HalalTaxonomyStatus, "not-halal">,
): Exclude<HalalTaxonomyStatus, "not-halal"> {
  return POSITIVE_RANK[a] <= POSITIVE_RANK[b] ? a : b;
}

/** What one item, taken alone, is allowed to support. */
export function evidenceSupports(item: EvidenceRecord): HalalTaxonomyStatus {
  if (item.claimedStatus === "not-halal") return "not-halal";
  if (item.claimedStatus === "unverified") return "unverified";

  let ceiling: Exclude<HalalTaxonomyStatus, "not-halal"> =
    KIND_CEILING[item.kind] as Exclude<HalalTaxonomyStatus, "not-halal">;

  // A certification with no named body is only a statement about a claim.
  if (
    item.kind === "certification" &&
    !(item.certificationBody && item.certificationBody.trim())
  )
    ceiling = "self-declared";

  if (interestedParty(item)) ceiling = weakest(ceiling, "self-declared");

  return weakest(ceiling, item.claimedStatus);
}

export function assessEvidence(
  item: EvidenceRecord,
  now: number,
): AssessedEvidence {
  const effectiveExpiresAt = effectiveExpiry(item);
  return {
    ...item,
    effectiveExpiresAt,
    current: effectiveExpiresAt > now,
    supports: evidenceSupports(item),
    interested: interestedParty(item),
  };
}

const EMPTY_ASSESSMENT: HalalAssessment = {
  status: "unverified",
  confidence: "none",
  evidenceCount: 0,
  currentEvidenceCount: 0,
  staleEvidenceCount: 0,
  contributorCount: 0,
  scope: null,
  scopes: [],
  latestEvidenceAt: null,
  earliestExpiryAt: null,
  needsReverification: false,
  conflict: null,
  reasons: ["No halal evidence has been submitted for this branch yet."],
};

/**
 * Turn approved evidence into the public status. Callers pass only approved
 * rows; anything else is ignored defensively.
 */
export function deriveHalalAssessment(
  evidence: readonly EvidenceRecord[],
  now: number = Date.now(),
): HalalAssessment {
  const items = evidence.map((item) => assessEvidence(item, now));
  if (!items.length) return { ...EMPTY_ASSESSMENT };

  const current = items.filter((item) => item.current);
  const stale = items.filter((item) => !item.current);
  const latestEvidenceAt = items.reduce(
    (latest, item) => Math.max(latest, item.capturedAt),
    Number.NEGATIVE_INFINITY,
  );
  const earliestExpiryAt = current.length
    ? current.reduce(
        (earliest, item) => Math.min(earliest, item.effectiveExpiresAt),
        Number.POSITIVE_INFINITY,
      )
    : null;

  const base = {
    evidenceCount: items.length,
    currentEvidenceCount: current.length,
    staleEvidenceCount: stale.length,
    contributorCount: new Set(items.map((item) => item.submittedByUserId)).size,
    latestEvidenceAt: Number.isFinite(latestEvidenceAt) ? latestEvidenceAt : null,
    earliestExpiryAt,
  };

  if (!current.length)
    return {
      ...base,
      status: "unverified",
      confidence: "none",
      scope: null,
      scopes: [],
      needsReverification: true,
      conflict: null,
      reasons: [
        `All ${stale.length} evidence ${stale.length === 1 ? "item has" : "items have"} expired. Re-verification is needed before a status can be shown.`,
      ],
    };

  const negatives = current.filter((item) => item.supports === "not-halal");
  const positives = current.filter(
    (item) => item.supports !== "not-halal" && item.supports !== "unverified",
  );

  const scopesOf = (list: AssessedEvidence[]) =>
    [...new Set(list.map((item) => item.scope))];

  if (negatives.length && positives.length)
    return {
      ...base,
      status: "unverified",
      confidence: "none",
      scope: null,
      scopes: scopesOf(current),
      needsReverification: true,
      conflict: {
        positiveEvidenceIds: positives.map((item) => item.id),
        negativeEvidenceIds: negatives.map((item) => item.id),
      },
      reasons: [
        "Current evidence contradicts itself. The status stays Unverified and no confidence badge is shown until a moderator resolves the conflict.",
      ],
    };

  if (negatives.length) {
    const independent = new Set(
      negatives
        .filter((item) => !item.interested)
        .map((item) => item.submittedByUserId),
    ).size;
    const documentary = negatives.some((item) =>
      ["menu-photo", "packaging", "supplier-invoice"].includes(item.kind),
    );
    return {
      ...base,
      status: "not-halal",
      confidence: independent >= 2 || documentary ? "high" : "medium",
      scope: negatives[0].scope,
      scopes: scopesOf(negatives),
      needsReverification: false,
      conflict: null,
      reasons: [
        `${negatives.length} current ${negatives.length === 1 ? "item" : "items"} of direct evidence show the relevant food is not halal.`,
      ],
    };
  }

  if (!positives.length)
    return {
      ...base,
      status: "unverified",
      confidence: "none",
      scope: null,
      scopes: scopesOf(current),
      needsReverification: true,
      conflict: null,
      reasons: [
        "The evidence on file is not specific enough to decide. Unverified does not mean the food is not halal.",
      ],
    };

  const reasons: string[] = [];
  const supportersOf = (status: HalalTaxonomyStatus) =>
    positives.filter((item) => statusRank(item.supports) >= statusRank(status));

  let status: HalalTaxonomyStatus = "self-declared";
  let supporting = positives;

  const verifiedItems = supportersOf("verified");
  const communityItems = supportersOf("community-verified");
  const communityContributors = new Set(
    communityItems.map((item) => item.submittedByUserId),
  );
  // `halal-options` is a scope claim, not a strength tier, so it is matched
  // exactly. Using a rank threshold here would let a venue-wide claim that
  // failed the community rule fall through and be relabelled as options-only.
  const optionItems = positives.filter((item) => item.supports === "halal-options");

  if (verifiedItems.length) {
    status = "verified";
    supporting = verifiedItems;
    const body = verifiedItems.find((item) => item.certificationBody)
      ?.certificationBody;
    reasons.push(
      body
        ? `Recognised certification from ${body} covers this branch.`
        : "Independently verified sourcing covers this branch.",
    );
  } else if (communityItems.length >= 2 && communityContributors.size >= 2) {
    status = "community-verified";
    supporting = communityItems;
    reasons.push(
      `${communityItems.length} consistent submissions from ${communityContributors.size} contributors support the halal claim.`,
    );
  } else if (optionItems.length) {
    status = "halal-options";
    supporting = optionItems;
    reasons.push(
      "Only the identified dishes or meat sources are represented as halal.",
    );
  } else {
    status = "self-declared";
    supporting = positives;
    if (communityItems.length === 1 || communityContributors.size === 1)
      reasons.push(
        "Only one contributor has supported this claim, so it stays Self declared until a second independent submission arrives.",
      );
    else
      reasons.push(
        "The restaurant claims halal status but independent evidence is still incomplete.",
      );
  }

  if (positives.some((item) => item.interested))
    reasons.push(
      "Some evidence comes from a declared interested party and is capped at Self declared.",
    );

  const expiringSoon =
    earliestExpiryAt !== null && earliestExpiryAt - now <= 30 * DAY_MS;
  if (expiringSoon)
    reasons.push("The earliest evidence expiry is less than 30 days away.");
  if (stale.length)
    reasons.push(
      `${stale.length} older ${stale.length === 1 ? "item has" : "items have"} expired and no longer count towards the status.`,
    );

  const scopes = scopesOf(supporting);
  const venueWide = scopes.includes("venue");
  if (!venueWide)
    reasons.push(
      "The evidence covers part of the menu or operation, not the whole venue.",
    );

  let confidence: Confidence;
  if (status === "verified") confidence = expiringSoon || !venueWide ? "medium" : "high";
  else if (status === "community-verified")
    confidence = communityContributors.size >= 4 && !expiringSoon ? "high" : "medium";
  else if (status === "halal-options") confidence = optionItems.length >= 2 ? "medium" : "low";
  else confidence = "low";

  return {
    ...base,
    status,
    confidence,
    scope: supporting[0]?.scope ?? null,
    scopes,
    needsReverification: expiringSoon || stale.length > 0,
    conflict: null,
    reasons,
  };
}

/* ------------------------------------------------------------------ copy -- */

export type StatusCopy = {
  label: string;
  tone: "verified" | "community" | "options" | "declared" | "unknown" | "negative";
  summary: string;
  minimumEvidence: string;
};

export const STATUS_COPY: Record<HalalTaxonomyStatus, StatusCopy> = {
  verified: {
    label: "Verified halal",
    tone: "verified",
    summary: "Strong evidence covers the relevant menu or establishment.",
    minimumEvidence:
      "Recognised certification or independently verified sourcing, with scope and date.",
  },
  "community-verified": {
    label: "Community verified",
    tone: "community",
    summary: "Several credible contributors independently support the halal claim.",
    minimumEvidence:
      "Multiple consistent, recent submissions with no unresolved contradiction.",
  },
  "halal-options": {
    label: "Halal options",
    tone: "options",
    summary: "Only identified dishes or meat sources are represented as halal.",
    minimumEvidence:
      "Evidence identifying exactly what is halal and any shared-kitchen constraints.",
  },
  "self-declared": {
    label: "Self declared halal",
    tone: "declared",
    summary: "The restaurant claims halal status but independent evidence is incomplete.",
    minimumEvidence:
      "An owner statement, menu claim, website, sign or direct communication, with a date.",
  },
  unverified: {
    label: "Unverified",
    tone: "unknown",
    summary:
      "There is not enough current evidence to decide. Unverified does not mean not halal.",
    minimumEvidence:
      "The default state when evidence is missing, stale, ambiguous or conflicting.",
  },
  "not-halal": {
    label: "Not halal",
    tone: "negative",
    summary: "Reliable evidence shows the relevant food is not halal.",
    minimumEvidence:
      "Direct menu, ingredient, supplier or restaurant evidence. Never inferred from absence.",
  },
};

export const CONFIDENCE_COPY: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  none: "No confidence level",
};

export const EVIDENCE_KIND_COPY: Record<EvidenceKind, string> = {
  certification: "Halal certificate",
  "supplier-invoice": "Supplier invoice",
  packaging: "Product packaging",
  "menu-photo": "Menu photo",
  "official-website": "Official website",
  "restaurant-statement": "Restaurant statement",
  "first-hand": "First-hand verification",
};

export const EVIDENCE_SCOPE_COPY: Record<EvidenceScope, string> = {
  venue: "Whole venue",
  "meat-only": "Meat only",
  "selected-dishes": "Selected dishes",
  branch: "This branch only",
  "delivery-kitchen": "Delivery kitchen",
  "time-period": "A stated time period",
};

export const RELATIONSHIP_COPY: Record<Relationship, string> = {
  none: "No relationship with the restaurant",
  owner: "Owner",
  staff: "Employee or staff",
  agency: "Agency acting for the restaurant",
  family: "Family of the owner or staff",
  "paid-creator": "Compensated creator",
};

/** Human-readable age used next to every strong claim. */
export function formatEvidenceAge(capturedAt: number, now: number): string {
  const days = Math.floor((now - capturedAt) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(days / 365)} years ago`;
}
