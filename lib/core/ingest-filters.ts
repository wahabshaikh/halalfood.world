/**
 * What the Scout importer refuses to list. Two rules:
 *
 * - Ahmadiyya places (their mosques, community halls and Jalsa stalls). The
 *   community this guide serves doesn't treat them as Muslim institutions.
 * - Alcohol-led places: pubs, bars, breweries, wine bars. The same rule that
 *   hides those listings (`hiddenListingReason`, on the name and types), so the
 *   two never disagree.
 *
 * Pure and conservative: a name has to say it. "Ahmadi" is also a common
 * Afghan and Persian surname ("Ahmadi Kabob"), so on its own it needs a
 * community word beside it (Muslim, Jamaat, mosque, …).
 */
import { hiddenListingReason } from "./listing-visibility";

export type IngestRejection = { rejected: "ahmadiyya" | "alcohol_led"; reason: string };

export type IngestCandidate = {
  name: string;
  description?: string | null;
  /** Google place types or cuisine labels ("bar", "wine_bar", "Pub"). */
  types?: readonly string[] | null;
};

function plain(value: string): string {
  return ` ${value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** Always Ahmadiyya, whatever surrounds them. */
const AHMADIYYA_TERMS = [
  / ahmadiy+a?h? /, // Ahmadiyya, Ahmadiya, Ahmadiyyah
  / ahmediy+a?h? /,
  / qadiani?s? /,
  / quadiani?s? /,
  / lahori ahmad/,
  / bait ?ul ?futuh /, // Baitul Futuh, Bait ul Futuh, Bait-ul-Futuh
  / jalsa salana /,
  / majlis khuddam ?ul ?ahmad/,
  / lajna imaillah /,
];

/** "Ahmadi" counts only next to one of these. */
const COMMUNITY_WORDS = / (muslim|muslims|jamaat|jama at|jamat|mosque|masjid|community|mission|khilafat|anjuman|caliph|khalifa|ahmad nagar) /;

function ahmadiyyaReason(text: string): string | null {
  if (AHMADIYYA_TERMS.some((pattern) => pattern.test(text))) return "it is an Ahmadiyya place";
  if (/ ahmadi(s)? /.test(text) && COMMUNITY_WORDS.test(text)) return "it is an Ahmadiyya place";
  return null;
}

/** Labels that are a venue type, not a cuisine: "Wine bar" → "wine_bar". */
function typeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Why the importer won't list this place, or null when it may. */
export function ingestRejection(input: IngestCandidate): IngestRejection | null {
  const text = plain([input.name, input.description ?? ""].join(" "));
  const ahmadiyya = ahmadiyyaReason(text);
  if (ahmadiyya) return { rejected: "ahmadiyya", reason: `Not listed: ${ahmadiyya}.` };
  const types = (input.types ?? []).filter((value) => typeof value === "string").map(typeKey);
  const hidden = hiddenListingReason({ name: input.name, types });
  // Only the name and types: a description saying "next to the old pub" is not a pub.
  if (hidden) return { rejected: "alcohol_led", reason: "Not listed: it looks like a pub, bar, brewery or wine bar." };
  return null;
}
