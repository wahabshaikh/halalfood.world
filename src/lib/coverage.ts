/**
 * Coverage levels and city demand.
 *
 * The launch is a global network that starts deep in one city, not a Mumbai
 * product with "coming soon" pages everywhere else. A visitor whose city is
 * thin should see honestly how much is indexed and be able to ask for more —
 * that request is the demand signal that orders the enrichment queue.
 */

export const COVERAGE_LEVELS = [
  "indexed",
  "enriched",
  "intelligent",
  "trusted",
] as const;

export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export type CoverageCopy = {
  label: string;
  meaning: string;
  experience: string;
};

export const COVERAGE_COPY: Record<CoverageLevel, CoverageCopy> = {
  indexed: {
    label: "Indexed",
    meaning: "We know this restaurant exists and where it is.",
    experience: "A basic page and a map pin. Ask for deeper coverage.",
  },
  enriched: {
    label: "Enriched",
    meaning: "Menus, source links and attributes are attached.",
    experience: "A useful factual page with visible source coverage.",
  },
  intelligent: {
    label: "Intelligent",
    meaning: "Halal evidence, dish consensus and confidence are computed.",
    experience: "Decision-ready guidance on the place and its dishes.",
  },
  trusted: {
    label: "Trusted",
    meaning: "Enough first-hand verified local evidence to rely on.",
    experience: "High-confidence local intelligence with change history.",
  },
};

export type CoverageInputs = {
  /** Current, approved halal evidence items. */
  evidenceCount: number;
  /** Observations carrying a source and a date. */
  observationCount: number;
  dishCount: number;
  checkInCount: number;
  verifiedCheckInCount: number;
  distinctContributors: number;
  hasInspection: boolean;
};

/**
 * Derive one place's coverage level. Deliberately conservative: a level is a
 * promise about what a visitor will find, so it is only claimed when the
 * evidence behind it actually exists.
 */
export function coverageLevel(inputs: CoverageInputs): CoverageLevel {
  const {
    evidenceCount,
    observationCount,
    dishCount,
    checkInCount,
    verifiedCheckInCount,
    distinctContributors,
  } = inputs;

  if (
    verifiedCheckInCount >= 5 &&
    distinctContributors >= 3 &&
    evidenceCount >= 2 &&
    dishCount >= 3
  )
    return "trusted";

  if (evidenceCount >= 1 && (dishCount >= 3 || checkInCount >= 3))
    return "intelligent";

  if (observationCount >= 3 || dishCount >= 1 || inputs.hasInspection)
    return "enriched";

  return "indexed";
}

export type CityCoverage = {
  citySlug: string;
  total: number;
  indexed: number;
  enriched: number;
  intelligent: number;
  trusted: number;
  /** Share of places at enriched or better, 0-100. */
  enrichedPercent: number;
  requests: number;
  contributors: number;
};

/**
 * The honest headline for a city page. It never rounds up: a city with almost
 * nothing says so, because overstating coverage is the fastest way to lose the
 * trust the product is built on.
 */
export function coverageHeadline(coverage: CityCoverage): string {
  const name = coverage.citySlug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  if (!coverage.total) return `${name} is not indexed yet.`;
  if (coverage.enrichedPercent === 0)
    return `${name} has ${coverage.total.toLocaleString()} restaurants indexed and none enriched yet.`;
  return `${name} is ${coverage.enrichedPercent}% enriched — ${coverage.total.toLocaleString()} indexed, ${(coverage.enriched + coverage.intelligent + coverage.trusted).toLocaleString()} with attached evidence.`;
}

export function summarizeCityCoverage(
  citySlug: string,
  counts: Partial<Record<CoverageLevel, number>>,
  extras: { requests?: number; contributors?: number } = {},
): CityCoverage {
  const indexed = counts.indexed ?? 0;
  const enriched = counts.enriched ?? 0;
  const intelligent = counts.intelligent ?? 0;
  const trusted = counts.trusted ?? 0;
  const total = indexed + enriched + intelligent + trusted;
  return {
    citySlug,
    total,
    indexed,
    enriched,
    intelligent,
    trusted,
    enrichedPercent: total
      ? Math.round(((enriched + intelligent + trusted) / total) * 100)
      : 0,
    requests: extras.requests ?? 0,
    contributors: extras.contributors ?? 0,
  };
}

/**
 * Which city to enrich next. Demand the product can observe — requests,
 * searches, page views — beats founder intuition, and a city with local
 * contributors moves further per unit of spend.
 */
export function cityDemandScore(input: {
  requests: number;
  searches: number;
  placeViews: number;
  contributors: number;
  enrichedPercent: number;
}): number {
  const demand =
    input.requests * 8 + input.searches * 2 + input.placeViews * 0.5;
  const readiness = 1 + Math.min(input.contributors, 20) * 0.1;
  // Cities that are already well covered gain less from more spend.
  const headroom = 1 - Math.min(input.enrichedPercent, 100) / 100;
  return Math.round(demand * readiness * (0.25 + headroom * 0.75));
}
