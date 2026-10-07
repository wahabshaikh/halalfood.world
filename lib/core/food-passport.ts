/**
 * The food passport on /me: where someone has eaten, counted by coverage
 * rather than volume, plus five milestones (spec §6.26).
 */

export type PassportCheck = {
  placeId: string;
  citySlug: string;
  country: string | null;
  cuisines: string[];
  createdAt: number;
};

export type FoodPassport = {
  checks: number;
  places: number;
  cities: number;
  cuisines: number;
  countries: number;
  /** Places with two or more checks. */
  wentBack: number;
};

export function buildFoodPassport(checks: readonly PassportCheck[]): FoodPassport {
  const perPlace = new Map<string, number>();
  const cities = new Set<string>();
  const cuisines = new Set<string>();
  const countries = new Set<string>();
  for (const check of checks) {
    perPlace.set(check.placeId, (perPlace.get(check.placeId) ?? 0) + 1);
    if (check.citySlug) cities.add(check.citySlug);
    if (check.country) countries.add(check.country.toLowerCase());
    for (const cuisine of check.cuisines) if (cuisine.trim()) cuisines.add(cuisine.trim().toLowerCase());
  }
  return {
    checks: checks.length,
    places: perPlace.size,
    cities: cities.size,
    cuisines: cuisines.size,
    countries: countries.size,
    wentBack: [...perPlace.values()].filter((count) => count >= 2).length,
  };
}

export type Milestone = {
  key: "first-check" | "first-verify" | "10-cuisines" | "regular" | "5-cities";
  label: string;
  description: string;
  progress: number;
  target: number;
  achieved: boolean;
};

export function buildMilestones(passport: FoodPassport, helpedVerify: number): Milestone[] {
  const make = (key: Milestone["key"], label: string, description: string, progress: number, target: number): Milestone => ({
    key,
    label,
    description,
    progress: Math.min(progress, target),
    target,
    achieved: progress >= target,
  });
  return [
    make("first-check", "First check", "Check a place.", passport.checks, 1),
    make("first-verify", "Verifier", "Be one of the 3 checks that verify a place.", helpedVerify, 1),
    make("10-cuisines", "Cuisine range", "Check places across 10 cuisines.", passport.cuisines, 10),
    make("regular", "Regular", "Go back to 3 places.", passport.wentBack, 3),
    make("5-cities", "Traveller", "Check places in 5 cities.", passport.cities, 5),
  ];
}
