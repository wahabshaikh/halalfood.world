/** Client-safe: no database imports. Used by the API, /search and the forms. */

/** Longest query we search for, in characters (code points). */
export const SEARCH_QUERY_MAX_CHARS = 64;

/**
 * Trim, collapse whitespace, and keep the first SEARCH_QUERY_MAX_CHARS
 * characters. A place matching the full query also matches its first 64
 * characters, so the cap never hides a result; no real name is that long.
 */
export function normalizeSearchQuery(raw: string, maxChars = SEARCH_QUERY_MAX_CHARS): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const chars = Array.from(collapsed);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("").trimEnd() : collapsed;
}
