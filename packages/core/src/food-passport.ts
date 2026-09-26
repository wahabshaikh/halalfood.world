/**
 * The food passport: exploration tracked as coverage, not volume.
 *
 * Verified and self-reported visits are counted separately everywhere, and the
 * milestones reward diversity, revisits, corrections and useful evidence
 * rather than raw review counts.
 */

export type PassportVisit = {
  placeId: string;
  citySlug: string;
  neighbourhood: string | null;
  country: string | null;
  cuisines: string[];
  verified: boolean;
  visitedAt: number;
};

export type CoverageBucket = { key: string; label: string; places: number };

export type FoodPassport = {
  verifiedVisits: number;
  unverifiedVisits: number;
  distinctPlaces: number;
  revisits: number;
  cities: CoverageBucket[];
  neighbourhoods: CoverageBucket[];
  countries: CoverageBucket[];
  cuisines: CoverageBucket[];
  firstVisitAt: number | null;
  lastVisitAt: number | null;
};

function bucket(
  entries: Iterable<{ key: string; label: string; placeId: string }>,
): CoverageBucket[] {
  const map = new Map<string, { label: string; places: Set<string> }>();
  for (const entry of entries) {
    if (!entry.key) continue;
    const found = map.get(entry.key) ?? { label: entry.label, places: new Set<string>() };
    found.places.add(entry.placeId);
    map.set(entry.key, found);
  }
  return [...map.entries()]
    .map(([key, value]) => ({ key, label: value.label, places: value.places.size }))
    .sort((a, b) => b.places - a.places || a.label.localeCompare(b.label));
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function buildFoodPassport(
  visits: readonly PassportVisit[],
): FoodPassport {
  const placeVisitCounts = new Map<string, number>();
  let verifiedVisits = 0;
  let unverifiedVisits = 0;
  let firstVisitAt: number | null = null;
  let lastVisitAt: number | null = null;

  for (const visit of visits) {
    placeVisitCounts.set(visit.placeId, (placeVisitCounts.get(visit.placeId) ?? 0) + 1);
    if (visit.verified) verifiedVisits += 1;
    else unverifiedVisits += 1;
    firstVisitAt = firstVisitAt === null ? visit.visitedAt : Math.min(firstVisitAt, visit.visitedAt);
    lastVisitAt = lastVisitAt === null ? visit.visitedAt : Math.max(lastVisitAt, visit.visitedAt);
  }

  const revisits = [...placeVisitCounts.values()].filter((count) => count > 1).length;

  return {
    verifiedVisits,
    unverifiedVisits,
    distinctPlaces: placeVisitCounts.size,
    revisits,
    cities: bucket(
      visits.map((visit) => ({
        key: visit.citySlug,
        label: titleCase(visit.citySlug),
        placeId: visit.placeId,
      })),
    ),
    neighbourhoods: bucket(
      visits
        .filter((visit) => visit.neighbourhood)
        .map((visit) => ({
          key: `${visit.citySlug}:${visit.neighbourhood}`,
          label: visit.neighbourhood as string,
          placeId: visit.placeId,
        })),
    ),
    countries: bucket(
      visits
        .filter((visit) => visit.country)
        .map((visit) => ({
          key: visit.country as string,
          label: visit.country as string,
          placeId: visit.placeId,
        })),
    ),
    cuisines: bucket(
      visits.flatMap((visit) =>
        visit.cuisines.map((cuisine) => ({
          key: cuisine.toLowerCase(),
          label: cuisine,
          placeId: visit.placeId,
        })),
      ),
    ),
    firstVisitAt,
    lastVisitAt,
  };
}

export type Milestone = {
  key: string;
  label: string;
  description: string;
  progress: number;
  target: number;
  achieved: boolean;
};

export type MilestoneInputs = {
  passport: FoodPassport;
  acceptedEvidence: number;
  acceptedCorrections: number;
  reverifiedStalePlaces: number;
};

/**
 * Milestones reward diversity, revisits, corrections and useful evidence. None
 * of them count raw review volume, by design.
 */
export function buildMilestones(inputs: MilestoneInputs): Milestone[] {
  const { passport } = inputs;
  const make = (
    key: string,
    label: string,
    description: string,
    progress: number,
    target: number,
  ): Milestone => ({
    key,
    label,
    description,
    progress: Math.min(progress, target),
    target,
    achieved: progress >= target,
  });

  return [
    make(
      "neighbourhoods",
      "Neighbourhood explorer",
      "Eat in five different neighbourhoods.",
      passport.neighbourhoods.length,
      5,
    ),
    make(
      "cuisines",
      "Cuisine range",
      "Try eight different cuisines.",
      passport.cuisines.length,
      8,
    ),
    make(
      "revisits",
      "Regular",
      "Return to five places you already recorded.",
      passport.revisits,
      5,
    ),
    make(
      "verified",
      "Verified diner",
      "Record ten visits verified by location or receipt.",
      passport.verifiedVisits,
      10,
    ),
    make(
      "evidence",
      "Evidence contributor",
      "Have five halal evidence submissions accepted.",
      inputs.acceptedEvidence,
      5,
    ),
    make(
      "reverification",
      "Freshness keeper",
      "Re-verify three places whose evidence had gone stale.",
      inputs.reverifiedStalePlaces,
      3,
    ),
    make(
      "corrections",
      "Careful corrector",
      "Get five factual corrections accepted.",
      inputs.acceptedCorrections,
      5,
    ),
  ];
}
