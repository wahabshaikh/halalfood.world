/**
 * Cached city coverage for the city page and its coverage API.
 *
 * The loader has to throw when D1 fails. `cachedRead` only stores a resolved
 * value, so a thrown error is not kept for the TTL. Callers catch outside
 * this layer and render the fallback ("Evidence status could not be loaded")
 * instead of treating the failure as a coverage result.
 */

import type { CityCoverage } from "@halalfood/core/coverage";
import { getCityCoverage } from "./coverage-repository";
import { listingCachedRead } from "./listing-cache";

export const CITY_COVERAGE_TTL_SECONDS = 10 * 60;

export function cityCoverageCacheKey(citySlug: string) {
  return `places:coverage:v1:${citySlug}`;
}

export function loadCachedCityCoverage(
  citySlug: string,
  load: (citySlug: string) => Promise<CityCoverage> = getCityCoverage,
): Promise<CityCoverage> {
  return listingCachedRead(cityCoverageCacheKey(citySlug), CITY_COVERAGE_TTL_SECONDS, () =>
    load(citySlug),
  );
}
