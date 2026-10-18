/**
 * When to trust a geocoder's answer for a Scout place sent without lat/lng.
 * Pure: lib/scout/geocode.ts calls Google and passes its results here.
 *
 * The rule, on Google's results in its own order:
 *
 * 1. No result with valid coordinates: `no_result`.
 * 2. Another result more than AMBIGUOUS_SPREAD_METERS from the first:
 *    `ambiguous`. The address could be in two places, so we don't pick one.
 * 3. The first result's address doesn't name the city (whole words, accents
 *    and case ignored): `wrong_city`.
 * 4. A country was sent and the address's last part is a different country
 *    (names and a few common short forms: UK, GB, USA, UAE, …): `wrong_country`.
 *
 * Otherwise the first result's coordinates are used. A failure means no
 * coordinates, never a guess such as a city centre.
 */
import { normalizeText } from "./media-match";
import { distanceMeters, type LatLng } from "./place-candidates";

export const AMBIGUOUS_SPREAD_METERS = 1000;

export type GeocodeCandidate = { formattedAddress: string; lat: number; lng: number };

export type GeocodeRejection = "no_result" | "ambiguous" | "wrong_city" | "wrong_country";

export type GeocodeVerdict = ({ ok: true } & LatLng) | { ok: false; reason: GeocodeRejection };

/** Spellings of one country that Google and Scout may use for each other. */
const COUNTRY_GROUPS: readonly string[][] = [
  ["united kingdom", "uk", "gb", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  ["united states", "united states of america", "usa", "us"],
  ["united arab emirates", "uae", "ae"],
  ["turkey", "turkiye", "tr"],
  ["netherlands", "the netherlands", "holland", "nl"],
  ["czechia", "czech republic", "cz"],
];

function sameCountry(a: string, b: string): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return COUNTRY_GROUPS.some((group) => group.includes(left) && group.includes(right));
}

function namesCity(address: string, city: string): boolean {
  const wanted = normalizeText(city);
  return Boolean(wanted) && ` ${normalizeText(address)} `.includes(` ${wanted} `);
}

function valid(candidate: GeocodeCandidate): boolean {
  const { lat, lng } = candidate;
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Apply the rule above. */
export function judgeGeocode(results: readonly GeocodeCandidate[], expected: { city: string; country?: string | null }): GeocodeVerdict {
  const usable = results.filter(valid);
  const [top] = usable;
  if (!top) return { ok: false, reason: "no_result" };
  if (usable.slice(1).some((other) => distanceMeters(top, other) > AMBIGUOUS_SPREAD_METERS)) return { ok: false, reason: "ambiguous" };
  if (!namesCity(top.formattedAddress, expected.city)) return { ok: false, reason: "wrong_city" };
  if (expected.country) {
    // "7 Boundary St, London E2 7JE, UK", "Sheikh Zayed Rd - Dubai - United Arab Emirates": the country is the last
    // part; words with digits in it are a postcode.
    const last = top.formattedAddress.split(/,| - /).pop() ?? "";
    const country = normalizeText(last).split(" ").filter((word) => !/\d/.test(word)).join(" ");
    if (!sameCountry(country, expected.country)) return { ok: false, reason: "wrong_country" };
  }
  return { ok: true, lat: top.lat, lng: top.lng };
}

/** The Text Search query for an address: street, then city and country unless the street already names them. */
export function geocodeQuery(input: { address: string; city: string; country?: string | null }, max = 120): string {
  const parts = [input.address.trim()];
  if (!namesCity(input.address, input.city)) parts.push(input.city.trim());
  if (input.country && !` ${normalizeText(input.address)} `.includes(` ${normalizeText(input.country)} `)) parts.push(input.country.trim());
  const query = parts.filter(Boolean).join(", ").replace(/\s+/g, " ");
  return query.length <= max ? query : query.slice(0, max).replace(/[\s,]+\S*$/, "");
}
