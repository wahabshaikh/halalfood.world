/**
 * Parsing and serialising the discovery filter set.
 *
 * The filters are deliberately split the way the product splits its facts:
 * halal status filters, factual policy filters, and food/practical filters.
 * Everything round-trips through the URL so a filtered search is shareable and
 * server-renderable.
 */

import {
  HALAL_STATUSES,
  isHalalTaxonomyStatus,
  type HalalTaxonomyStatus,
} from "./halal-taxonomy";
import { FACT_KEYS, MEALS, SERVICE_TYPES, type FactKey } from "./place-facts";

export const SORT_OPTIONS = [
  "recommended",
  "would-return",
  "evidence",
  "distance",
  "recent",
  "value",
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

/** Fact filters are opt-in requirements, expressed as the reassuring answer. */
export const FACT_FILTER_KEYS = [
  "noAlcohol",
  "noPork",
  "dedicatedKitchen",
  "muslimOwned",
  "prayerSpace",
  "womenFriendly",
  "vegetarian",
  "certified",
] as const;

export type FactFilterKey = (typeof FACT_FILTER_KEYS)[number];

export const FACT_FILTER_COPY: Record<FactFilterKey, string> = {
  noAlcohol: "No alcohol",
  noPork: "No pork",
  dedicatedKitchen: "Dedicated halal kitchen",
  muslimOwned: "Muslim-owned",
  prayerSpace: "Prayer space",
  womenFriendly: "Women-friendly facilities",
  vegetarian: "Vegetarian options",
  certified: "Certified",
};

/** Each fact filter maps to one column and the value it must equal. */
export const FACT_FILTER_SQL: Record<
  Exclude<FactFilterKey, "certified">,
  { column: string; equals: "yes" | "no" }
> = {
  noAlcohol: { column: "serves_alcohol", equals: "no" },
  noPork: { column: "serves_pork", equals: "no" },
  dedicatedKitchen: { column: "dedicated_halal_kitchen", equals: "yes" },
  muslimOwned: { column: "muslim_owned", equals: "yes" },
  prayerSpace: { column: "prayer_space", equals: "yes" },
  womenFriendly: { column: "women_friendly_facilities", equals: "yes" },
  vegetarian: { column: "vegetarian_options", equals: "yes" },
};

export const STATUS_FILTER_ORDER: HalalTaxonomyStatus[] = [...HALAL_STATUSES];

export type DiscoveryFilters = {
  q: string | null;
  /** Empty means "every status", including Not halal — absence is information. */
  statuses: HalalTaxonomyStatus[];
  facts: FactFilterKey[];
  cuisines: string[];
  dish: string | null;
  priceBands: number[];
  serviceTypes: string[];
  meals: string[];
  openNow: boolean;
  maxDistanceKm: number | null;
  sort: SortOption;
  /** Only apply the signed-in user's saved dietary standards when asked. */
  applyMyStandards: boolean;
};

export const EMPTY_FILTERS: DiscoveryFilters = {
  q: null,
  statuses: [],
  facts: [],
  cuisines: [],
  dish: null,
  priceBands: [],
  serviceTypes: [],
  meals: [],
  openNow: false,
  maxDistanceKm: null,
  sort: "recommended",
  applyMyStandards: false,
};

/**
 * Split a comma-separated parameter. Case is only folded for the vocabularies
 * that are lower-case by definition — the fact filter keys are camelCase, so
 * folding them here would silently drop every fact filter.
 */
function csv(value: string | null, { lower = true } = {}): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => (lower ? item.trim().toLowerCase() : item.trim()))
    .filter(Boolean)
    .slice(0, 20);
}

function text(value: string | null, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** Read filters from a `URLSearchParams`. Unknown values are dropped, not rejected. */
export function parseDiscoveryFilters(
  params: URLSearchParams,
): DiscoveryFilters {
  const statuses = csv(params.get("status")).filter(isHalalTaxonomyStatus);
  const facts = csv(params.get("facts"), { lower: false }).filter((key): key is FactFilterKey =>
    (FACT_FILTER_KEYS as readonly string[]).includes(key),
  );
  const priceBands = csv(params.get("price"))
    .map(Number)
    .filter((band) => Number.isInteger(band) && band >= 1 && band <= 4);
  const serviceTypes = csv(params.get("service")).filter((item) =>
    (SERVICE_TYPES as readonly string[]).includes(item),
  );
  const meals = csv(params.get("meal")).filter((item) =>
    (MEALS as readonly string[]).includes(item),
  );
  const sortRaw = params.get("sort");
  const sort = (SORT_OPTIONS as readonly string[]).includes(sortRaw ?? "")
    ? (sortRaw as SortOption)
    : "recommended";
  const distanceRaw = Number(params.get("within"));
  const maxDistanceKm =
    Number.isFinite(distanceRaw) && distanceRaw > 0 && distanceRaw <= 100
      ? Math.round(distanceRaw * 10) / 10
      : null;

  return {
    q: text(params.get("q"), 120),
    statuses: [...new Set(statuses)],
    facts: [...new Set(facts)],
    cuisines: [...new Set(csv(params.get("cuisine")))],
    dish: text(params.get("dish"), 80),
    priceBands: [...new Set(priceBands)].sort(),
    serviceTypes: [...new Set(serviceTypes)],
    meals: [...new Set(meals)],
    openNow: params.get("open") === "1",
    maxDistanceKm,
    sort,
    applyMyStandards: params.get("mine") === "1",
  };
}

/** Serialise back to a query string, omitting every default. */
export function serializeDiscoveryFilters(filters: DiscoveryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  if (filters.facts.length) params.set("facts", filters.facts.join(","));
  if (filters.cuisines.length) params.set("cuisine", filters.cuisines.join(","));
  if (filters.dish) params.set("dish", filters.dish);
  if (filters.priceBands.length) params.set("price", filters.priceBands.join(","));
  if (filters.serviceTypes.length) params.set("service", filters.serviceTypes.join(","));
  if (filters.meals.length) params.set("meal", filters.meals.join(","));
  if (filters.openNow) params.set("open", "1");
  if (filters.maxDistanceKm !== null) params.set("within", String(filters.maxDistanceKm));
  if (filters.sort !== "recommended") params.set("sort", filters.sort);
  if (filters.applyMyStandards) params.set("mine", "1");
  return params.toString();
}

/** How many filters the UI should report on the Filters chip. */
export function activeFilterCount(filters: DiscoveryFilters): number {
  return (
    filters.statuses.length +
    filters.facts.length +
    filters.cuisines.length +
    filters.priceBands.length +
    filters.serviceTypes.length +
    filters.meals.length +
    (filters.dish ? 1 : 0) +
    (filters.openNow ? 1 : 0) +
    (filters.maxDistanceKm !== null ? 1 : 0) +
    (filters.applyMyStandards ? 1 : 0)
  );
}

export function hasActiveFilters(filters: DiscoveryFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/**
 * Translate a user's saved dietary standards into filter selections, so
 * "apply my standards" is visible and editable rather than a hidden rule.
 */
export function filtersFromStandards(standards: {
  minimumStatus: HalalTaxonomyStatus;
  requireCertification: boolean;
  avoidAlcohol: boolean;
  avoidPork: boolean;
  requireDedicatedKitchen: boolean;
  requirePrayerSpace: boolean;
  vegetarianOnly: boolean;
}): Pick<DiscoveryFilters, "statuses" | "facts"> {
  const rank: Record<HalalTaxonomyStatus, number> = {
    verified: 5,
    "community-verified": 4,
    "halal-options": 3,
    "self-declared": 2,
    unverified: 1,
    "not-halal": 0,
  };
  const minimum = rank[standards.minimumStatus];
  const statuses = STATUS_FILTER_ORDER.filter(
    (status) => status !== "not-halal" && rank[status] >= minimum,
  );

  const facts: FactFilterKey[] = [];
  if (standards.requireCertification) facts.push("certified");
  if (standards.avoidAlcohol) facts.push("noAlcohol");
  if (standards.avoidPork) facts.push("noPork");
  if (standards.requireDedicatedKitchen) facts.push("dedicatedKitchen");
  if (standards.requirePrayerSpace) facts.push("prayerSpace");
  if (standards.vegetarianOnly) facts.push("vegetarian");

  return { statuses, facts };
}

export const SORT_COPY: Record<SortOption, string> = {
  recommended: "Recommended",
  "would-return": "Would return",
  evidence: "Evidence strength",
  distance: "Distance",
  recent: "Recently verified",
  value: "Value",
};

/** Fact filter keys mapped to the underlying fact columns, for UI labels. */
export const FACT_FILTER_TO_FACT: Partial<Record<FactFilterKey, FactKey>> = {
  noAlcohol: "servesAlcohol",
  noPork: "servesPork",
  dedicatedKitchen: "dedicatedHalalKitchen",
  muslimOwned: "muslimOwned",
  prayerSpace: "prayerSpace",
  womenFriendly: "womenFriendlyFacilities",
  vegetarian: "vegetarianOptions",
};

export const ALL_FACT_KEYS = FACT_KEYS;
