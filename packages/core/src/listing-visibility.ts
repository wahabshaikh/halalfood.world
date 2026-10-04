/**
 * Which existing listings stay on the public map.
 * Hiding is reversible: the row stays, and a later update can list it again.
 * "Bar and grill" is not enough on its own. Taverna is a restaurant word, not a tavern.
 */

/** Named in the launch audit. The stored row has no second Google signal. */
export const AUDIT_HIDDEN_PLACE_IDS = [
  "65992004-f61e-42b3-b4ea-2b7f9e8908ef",
] as const;

const CLEAR_TYPES = new Set([
  "brewery",
  "pub",
  "wine_bar",
  "beer_garden",
  "tavern",
]);

const AGREEING_TYPES = new Set([...CLEAR_TYPES, "bar", "night_club"]);

const NOT_A_CUISINE = new Set(["halal", "halal food"]);

function hasWord(name: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(name);
}

function clearName(name: string) {
  const value = name.normalize("NFKD");
  if (/beer\s+hall|beer\s+garden|beer\s+club|beer\s*house|brewery|brew\s*pub|brauhaus|hofbr|wine\s+bar|cu\s+bere/i.test(value))
    return "name";
  if (/&\s*beer\b|\band\s+beer\b/i.test(value)) return "name";
  if (hasWord(value, "pub")) return "name";
  if (hasWord(value, "tavern") && !/taverna/i.test(value)) return "name";
  return null;
}

function barAndGrill(name: string) {
  return /\bbar\s*(?:and|&)\s*grills?\b/i.test(name);
}

/**
 * A reason string when the listing should be hidden, or null when it stays listed.
 * `id` covers the audit exception. Name and Google types cover the general rule.
 */
export function hiddenListingReason(input: {
  id?: string | null;
  name: string;
  types?: readonly string[] | null;
}): string | null {
  if (input.id && (AUDIT_HIDDEN_PLACE_IDS as readonly string[]).includes(input.id))
    return "launch-audit";
  const name = input.name.trim();
  if (!name) return null;
  if (clearName(name)) return "name";
  const types = (input.types ?? []).map((type) => type.toLowerCase());
  if (types.some((type) => CLEAR_TYPES.has(type))) return "google-type";
  if (barAndGrill(name) && types.some((type) => AGREEING_TYPES.has(type)))
    return "bar-and-grill";
  return null;
}

/** Drop labels that are not cuisines. "Halal" produced "a halal Halal restaurant". */
export function displayCuisines(values: readonly string[] | null | undefined) {
  if (!values?.length) return [];
  return values
    .map((value) => value.trim())
    .filter((value) => value && !NOT_A_CUISINE.has(value.toLowerCase()));
}
