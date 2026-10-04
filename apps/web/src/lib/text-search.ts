import { sql, type SQL } from "drizzle-orm";

/**
 * Free-text search over D1 without LIKE.
 *
 * D1 sets SQLITE_LIMIT_LIKE_PATTERN_LENGTH to 50 bytes. `LIKE '%' || q || '%'`
 * therefore failed with "LIKE or GLOB pattern too complex" once the query was
 * 49 ASCII characters (fewer with multibyte text or escaped `%`/`_`), and the
 * search API turned that into a 503. `instr()` has no pattern limit, treats
 * `%` and `_` as plain characters (what the escaped LIKE did), and with
 * `lower()` on both sides it folds ASCII case exactly as LIKE did.
 */

export { normalizeSearchQuery, SEARCH_QUERY_MAX_CHARS } from "./search-query";

/** `column` contains `needle`, ASCII case-insensitive, any length. */
export function containsText(column: SQL, needle: string): SQL {
  return sql`instr(lower(${column}), lower(${needle})) > 0`;
}

/** `column` starts with `needle`, ASCII case-insensitive, any length. */
export function startsWithText(column: SQL, needle: string): SQL {
  return sql`instr(lower(${column}), lower(${needle})) = 1`;
}
