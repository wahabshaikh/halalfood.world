import {
  filtersFromStandards,
  parseDiscoveryFilters,
  type DiscoveryFilters,
} from "@halalfood/core/discovery-filters";
import { citySlugParam } from "@halalfood/core/params";
import {
  STANDARD_PRESETS,
  applyOnboardingStandard,
  type StandardPreset,
} from "@halalfood/core/social";
import { DEFAULT_PREFERENCES } from "@halalfood/core/user-preferences";

export type OnboardingPickQuery = {
  filters: DiscoveryFilters;
  citySlug: string | undefined;
};

function sameQuery(left: OnboardingPickQuery, right: OnboardingPickQuery): boolean {
  return (
    left.citySlug === right.citySlug &&
    left.filters.statuses.join(",") === right.filters.statuses.join(",") &&
    left.filters.facts.join(",") === right.filters.facts.join(",")
  );
}

/**
 * Places for "Pick 3 places".
 *
 * No standard means listed places in the home city, then any listed places.
 * A chosen standard is applied first. If that matches nothing, the same list
 * is tried without the standard, then without the city. Imported places with
 * no halal check are `unverified`, so a community standard must not be the
 * default or the step is empty.
 */
export function onboardingPickQueries(params: URLSearchParams): OnboardingPickQuery[] {
  const citySlug = citySlugParam(params.get("city")) ?? undefined;
  const standardChosen = params.get("standard") === "1";
  const presetRaw = params.get("preset");
  const preset: StandardPreset =
    presetRaw && STANDARD_PRESETS.includes(presetRaw as StandardPreset)
      ? (presetRaw as StandardPreset)
      : "community";
  const open = parseDiscoveryFilters(new URLSearchParams());
  const primary = standardChosen
    ? {
        ...open,
        ...filtersFromStandards(
          applyOnboardingStandard(DEFAULT_PREFERENCES, {
            preset,
            avoidAlcohol: params.get("noAlcohol") === "1",
            preferHandSlaughter: false,
          }),
        ),
      }
    : open;

  const queries: OnboardingPickQuery[] = [{ filters: primary, citySlug }];
  if (standardChosen) queries.push({ filters: open, citySlug });
  if (citySlug) queries.push({ filters: open, citySlug: undefined });
  return queries.filter(
    (query, index) => queries.findIndex((other) => sameQuery(query, other)) === index,
  );
}
