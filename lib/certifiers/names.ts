/**
 * Certifier names: the normalised form used to match the same body across sources and snapshots, and
 * the URL slug built from the official name.
 */

/** Legal-form words that sources add or drop at will ("Pty Ltd", "Inc.", "GmbH"). */
const LEGAL_SUFFIXES = new Set([
  "ab",
  "ag",
  "bhd",
  "bv",
  "co",
  "company",
  "corp",
  "corporation",
  "gmbh",
  "inc",
  "incorporated",
  "limited",
  "llc",
  "ltd",
  "plc",
  "private",
  "pt",
  "pte",
  "pty",
  "sa",
  "sdn",
  "sl",
  "spa",
  "srl",
]);

/** Words a slug or matcher must never be reduced to. */
const RESERVED_SLUGS = new Set([
  "advertise",
  "alerts",
  "changes",
  "check",
  "country",
  "expiring",
  "from",
  "guides",
  "methodology",
]);

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ");
}

/**
 * A name reduced to what identifies the body: accents, case, punctuation, bracketed abbreviations and
 * trailing legal forms removed. "ANIC Halal Authority Pty. Ltd." and "anic halal authority" match.
 */
export function normaliseName(name: string): string {
  const words = fold(name)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  // Drop legal forms from the end only, so "Halal Development Company" keeps its meaning mid-name.
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** Lowercase, hyphens, from the official name; at most 80 characters, cut on a word. */
export function certifierSlug(name: string): string {
  let slug = fold(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > 80) slug = slug.slice(0, 80).replace(/-[^-]*$/, "");
  if (!slug) slug = "certifier";
  return RESERVED_SLUGS.has(slug) ? `${slug}-certifier` : slug;
}

/** A slug that is not in `taken`: `name`, then `name-2`, `name-3`… */
export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = certifierSlug(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export type AliasIndex = ReadonlyMap<string, string>;

/** The certifier id an alias index knows for `name`, or null for a body we have not seen. */
export function matchCertifier(name: string, aliases: AliasIndex): string | null {
  return aliases.get(normaliseName(name)) ?? null;
}

/** Same body, different wording? Case, spacing and legal-form changes are not a rename. */
export function isRename(before: string, after: string): boolean {
  return normaliseName(before) !== normaliseName(after);
}

/** Valid `/certifiers/[slug]` segment, or null. */
export function certifierSlugParam(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase();
  return slug.length <= 90 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}
