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

/** Split off the longest known city name at either end of a query. */
export function splitCityQuery(q: string, citySlugs: readonly string[]): { citySlug: string | null; rest: string } {
  const words = normalizeSearchQuery(q).split(" ");
  const cities = new Map(citySlugs.map((slug) => [slug.toLowerCase(), slug]));
  for (let length = words.length; length > 0; length--) {
    const leading = cities.get(words.slice(0, length).join("-").toLowerCase());
    if (leading) return { citySlug: leading, rest: words.slice(length).join(" ") };
    const trailing = cities.get(words.slice(-length).join("-").toLowerCase());
    if (trailing) return { citySlug: trailing, rest: words.slice(0, -length).join(" ") };
  }
  return { citySlug: null, rest: words.join(" ") };
}
