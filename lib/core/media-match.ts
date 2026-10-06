/**
 * Matching a pasted reel or video to a place.
 *
 * We only ever have what the platform's public oEmbed returns: a caption or
 * title and the creator's name. So matching is deliberately conservative: a
 * place is suggested only when its name shows up in that text, and the diner
 * always confirms. An Instagram link carries no caption we can read, which
 * yields no suggestion and sends the diner to search instead. Nothing here
 * changes a place's halal status; a linked video is context, not evidence.
 */

export type MatchCandidate = {
  id: string;
  name: string;
  citySlug: string;
  addressLocality: string | null;
};

export type PlaceMatch = MatchCandidate & {
  /** 0 to 1. Only matches at or above MIN_MATCH_SCORE are returned. */
  score: number;
  confidence: "high" | "medium";
};

export const MIN_MATCH_SCORE = 0.6;
export const MAX_MATCHES = 3;
/** Words too common in place names to identify one. */
const GENERIC = new Set([
  "the", "and", "of", "at", "in", "restaurant", "cafe", "cafes", "kitchen", "house", "grill",
  "halal", "food", "foods", "bar", "bakery", "sweets", "dhaba", "biryani", "corner", "point",
  "centre", "center", "shop", "hotel", "palace", "mahal", "fast", "express", "original", "new",
  "best", "famous", "old", "al", "el", "bin",
]);

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words worth searching the places table for, longest and rarest first. */
export function captionSearchTerms(caption: string, max = 8): string[] {
  const seen = new Set<string>();
  const words = normalizeText(caption)
    .split(" ")
    .filter((word) => word.length >= 4 && !GENERIC.has(word) && !/^\d+$/.test(word));
  for (const word of words) seen.add(word);
  return [...seen].sort((a, b) => b.length - a.length).slice(0, max);
}

/**
 * Score one place against the caption. A full name appearing in the text is the
 * strong signal; otherwise the share of the name's distinctive words present,
 * with a bonus when the place's city is named too.
 */
export function scorePlace(caption: string, place: MatchCandidate): number {
  const text = ` ${normalizeText(caption)} `;
  const name = normalizeText(place.name);
  if (!name) return 0;
  const distinctive = name.split(" ").filter((word) => word.length >= 3 && !GENERIC.has(word));
  // A name made only of generic words identifies nothing.
  if (!distinctive.length) return 0;

  let score: number;
  if (text.includes(` ${name} `)) score = distinctive.length >= 2 || name.length >= 8 ? 0.9 : 0.7;
  else {
    const hits = distinctive.filter((word) => text.includes(` ${word} `)).length;
    // A single shared word among several is a coincidence, not a match.
    if (distinctive.length < 2 || hits < 2) return 0;
    score = 0.7 * (hits / distinctive.length);
  }
  const city = normalizeText(place.addressLocality || place.citySlug.replace(/-/g, " "));
  if (city && text.includes(` ${city} `)) score += 0.1;
  return Math.min(1, Math.round(score * 100) / 100);
}

export function matchPlaces(
  caption: string,
  candidates: readonly MatchCandidate[],
): PlaceMatch[] {
  if (!caption.trim()) return [];
  return candidates
    .map((place) => ({ place, score: scorePlace(caption, place) }))
    .filter((entry) => entry.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .slice(0, MAX_MATCHES)
    .map(({ place, score }) => ({
      ...place,
      score,
      confidence: score >= 0.85 ? "high" : "medium",
    }));
}
