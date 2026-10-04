import type { DiscoveryFilters } from "@halalfood/core/discovery-filters";

/**
 * What the map does with a 401 from `/api/discover`.
 *
 * A request that asked for personal data (the viewer's social pins, or a
 * "mine"/"friends" filter) falls back to everyone's places once. A request
 * that was already public gets an error and no state change at all, so the
 * effect that fetched has nothing new to react to.
 *
 * The returned `filters` is the same object when nothing changes. React
 * compares effect dependencies with `Object.is`, so a fresh `{ ...filters }`
 * here would re-run the fetch on every 401, which is the loop this replaced.
 */
export function unauthorizedFallback(state: {
  filters: DiscoveryFilters;
  signedIn: boolean;
}): { personal: boolean; filters: DiscoveryFilters; signedIn: false } {
  const personal = state.signedIn || state.filters.whose !== "everyone";
  const filters =
    state.filters.whose === "everyone" ? state.filters : { ...state.filters, whose: "everyone" as const };
  return { personal, filters, signedIn: false };
}
