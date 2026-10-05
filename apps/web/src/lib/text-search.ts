import { sql, type SQL } from "drizzle-orm";

/**
 * Free-text search over D1 without LIKE.
 *
 * D1 sets SQLITE_LIMIT_LIKE_PATTERN_LENGTH to 50 bytes. `LIKE '%' || q || '%'`
 * therefore failed with "LIKE or GLOB pattern too complex" once the query was
 * 49 ASCII characters (fewer with multibyte text or escaped `%`/`_`), and the
 * search API turned that into a 503. `instr()` has no pattern limit, treats
 * `%` and `_` as plain characters (what the escaped LIKE did). Case folding
 * is in `caseVariants` below.
 */

export { normalizeSearchQuery, SEARCH_QUERY_MAX_CHARS } from "./search-query";

/**
 * The spellings of `needle` that can appear in `lower(column)`.
 *
 * SQLite's lower() folds only ASCII, so `lower('CAFÉ')` is `'cafÉ'` and
 * `lower('Café')` is `'café'`. The needle's ASCII letters are lowered here the
 * same way, and its non-ASCII letters are tried all lower case, all upper case,
 * capitalised per word, and as typed (at most 4 spellings). So "café", "CAFÉ"
 * and "Café" find the same places, and "шаурма" finds "Шаурма". An ASCII-only
 * needle has one spelling, so its SQL is the same single instr() as before.
 * A letter whose other case is a different length (ß → SS, İ → i̇) is kept
 * as typed. Accents are not folded: "cafe" does not find "café" (v1.1).
 */
export function caseVariants(needle: string): string[] {
  const chars = Array.from(needle);
  const spell = (fold: (char: string, wordStart: boolean) => string) =>
    chars
      .map((char, index) => {
        if (char.codePointAt(0)! < 0x80) return char.toLowerCase();
        const folded = fold(char, index === 0 || /\s/.test(chars[index - 1]));
        return Array.from(folded).length === 1 ? folded : char;
      })
      .join("");
  return [
    ...new Set([
      spell((char) => char.toLowerCase()),
      spell((char) => char.toUpperCase()),
      // Capitalised words: "Шаурма", "Ταβέρνα".
      spell((char, wordStart) => (wordStart ? char.toUpperCase() : char.toLowerCase())),
      spell((char) => char),
    ]),
  ];
}

/**
 * Each spelling is one bound parameter, and D1 allows 100 per query. Where a
 * query repeats a needle many times (discovery's cuisine list), pass
 * `maxSpellings` 1 to keep the single lower-case spelling it had before.
 */
function anySpelling(
  column: SQL,
  needle: string,
  maxSpellings: number,
  test: (column: SQL, spelling: string) => SQL,
): SQL {
  const spellings = caseVariants(needle)
    .slice(0, Math.max(1, maxSpellings))
    .map((spelling) => test(column, spelling));
  return spellings.length === 1 ? spellings[0] : sql`(${sql.join(spellings, sql` OR `)})`;
}

/** `column` contains `needle`, case-insensitive (Unicode letters too), any length. */
export function containsText(column: SQL, needle: string, maxSpellings = 4): SQL {
  return anySpelling(column, needle, maxSpellings, (col, spelling) => sql`instr(lower(${col}), ${spelling}) > 0`);
}

/** `column` starts with `needle`, case-insensitive (Unicode letters too), any length. */
export function startsWithText(column: SQL, needle: string, maxSpellings = 4): SQL {
  return anySpelling(column, needle, maxSpellings, (col, spelling) => sql`instr(lower(${col}), ${spelling}) = 1`);
}
