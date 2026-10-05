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

/**
 * The toast's Sign in link: a 44x44 px tap target (min-h-11, min-w-11). The
 * negative vertical margin keeps the pill its usual height around it.
 */
export const TOAST_LINK_TAP_TARGET = "-my-3 h-auto min-h-11 min-w-11 px-1 font-extrabold";

/**
 * The toast's Dismiss: a 44x44 px button (size-11) around the same 15 px icon.
 * The -10 px margin keeps the 24 px footprint it had, so the pill does not grow.
 */
export const TOAST_DISMISS_TAP_TARGET = "-m-2.5 size-11 rounded-full";

/** The toast after a Friends/Yours 401 fell back to everyone's places. */
export const SCOPE_FALLBACK_NOTICE = "Sign in to see your places and your friends’ places.";

/**
 * Whether the toast over the map shows. The all-fail error box sits in the
 * same top strip of the map at narrow widths and carries its own Sign in, so
 * while it is up the toast stays hidden and the two never overlap.
 */
export function mapNoticeVisible(state: {
  notice: string;
  error: unknown;
  viewportTooWide: boolean;
}): boolean {
  return Boolean(state.notice) && !state.error && !state.viewportTooWide;
}

/**
 * The filters the address bar shows. After a 401 the map loads everyone's
 * places, but the URL keeps what the person asked for (whose=friends), so a
 * sign-in from any link on the page (the toast, the menu, the error box)
 * returns to that scope. Null `requested` means no fallback is in effect.
 */
export function filtersForUrl(
  filters: DiscoveryFilters,
  requested: DiscoveryFilters | null,
): DiscoveryFilters {
  return requested ?? filters;
}
