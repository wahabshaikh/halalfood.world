/**
 * What search says when it fails. A long or odd query is never the cause (it
 * is trimmed and capped, see text-search.ts), so these name the real cases:
 * our side failed, or the request did not get through.
 */
export const SEARCH_FAILED_TITLE = "Search isn’t working right now";
export const SEARCH_FAILED_DESCRIPTION =
  "Something went wrong on our side, not with what you typed. Please try again.";
export const SEARCH_FAILED_INLINE = "Search isn’t working right now. Please try again.";
