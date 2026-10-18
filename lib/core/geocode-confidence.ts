/**
 * When to trust a geocoder's answer for a Scout place sent without lat/lng.
 * Pure: lib/scout/geocode.ts calls Google and passes its results here.
 *
 * The rule, on Google's results in its own order:
 *
 * 1. No result with valid coordinates: `no_result`.
 * 2. Missing types, area types or route-only precision: `not_street_level`.
 * 3. Another result more than AMBIGUOUS_SPREAD_METERS from the first:
 *    `ambiguous`. The address could be in two places, so we don't pick one.
 * 4. Neither structured city/area names, formatted city text nor proximity
 *    within 40 km of the known city centre matches: `wrong_city`.
 * 5. A supplied country doesn't match the structured country (ISO/name), or
 *    any formatted-address part when that component is absent: `wrong_country`.
 *
 * Otherwise the first result's coordinates are used. A failure means no
 * coordinates, never a guess such as a city centre.
 */
import cityCoords from "@/lib/data/city_coords.json";
import { slugifyCity } from "./place-submission";
import { normalizeText } from "./media-match";
import { distanceMeters, type LatLng } from "./place-candidates";

export const AMBIGUOUS_SPREAD_METERS = 1000;

export const CITY_METRO_RADIUS_METERS = 40_000;
export type GeocodeAddressComponent = { longText?: string; shortText?: string; types?: readonly string[] };
export type GeocodeCandidate = { formattedAddress: string; lat: number; lng: number; types?: readonly string[]; addressComponents?: readonly GeocodeAddressComponent[] };

export type GeocodeRejection = "not_street_level" | "no_result" | "ambiguous" | "wrong_city" | "wrong_country";

export type GeocodeVerdict = ({ ok: true } & LatLng) | { ok: false; reason: GeocodeRejection };

/** Spellings of one country that Google and Scout may use for each other. */
const COUNTRY_GROUPS: readonly string[][] = [
  ["united kingdom", "uk", "gb", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  ["united states", "united states of america", "usa", "us"],
  ["united arab emirates", "uae", "ae"],
  ["turkey", "turkiye", "tr"],
  ["netherlands", "the netherlands", "holland", "nl"],
  ["czechia", "czech republic", "cz"],
  ["japan", "jp", "日本"],
  ["canada", "ca"],
  ["germany", "de", "deutschland"],
];

function geographicText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function countryName(value: string): string {
  const normalized = geographicText(value);
  if (/^[a-z]{2}$/.test(normalized)) {
    try {
      return geographicText(new Intl.DisplayNames(["en"], { type: "region" }).of(normalized.toUpperCase()) ?? normalized);
    } catch { /* Explicit country groups also work on runtimes without region display names. */ }
  }
  return normalized;
}

function sameCountry(a: string, b: string): boolean {
  const left = geographicText(a);
  const right = geographicText(b);
  if (!left || !right) return false;
  if (left === right || countryName(left) === countryName(right)) return true;
  return COUNTRY_GROUPS.some((group) => group.includes(left) && group.includes(right));
}

function namesCity(address: string, city: string): boolean {
  const wanted = normalizeText(city);
  return Boolean(wanted) && ` ${normalizeText(address)} `.includes(` ${wanted} `);
}

function cityName(value: string): string {
  const normalized = geographicText(value).replace(/ (city|ku|shi|ward)$/, "");
  return ["東京", "東京都"].includes(normalized) ? "tokyo" : normalized;
}

function matchesCity(candidate: GeocodeCandidate, city: string): boolean {
  const wanted = cityName(city);
  const named = candidate.addressComponents?.some((component) =>
    component.types?.some((type) => /^(locality|postal_town|administrative_area_level_[123]|sublocality.*|neighborhood|colloquial_area)$/.test(type)) &&
    [component.longText, component.shortText].some((text) => text && wanted && ` ${cityName(text)} `.includes(` ${wanted} `)),
  );
  const centre = (cityCoords as Record<string, LatLng>)[slugifyCity(city)];
  return Boolean(named) || namesCity(candidate.formattedAddress, city) || Boolean(centre && distanceMeters(candidate, centre) <= CITY_METRO_RADIUS_METERS);
}

function matchesCountry(candidate: GeocodeCandidate, country: string): boolean {
  const components = candidate.addressComponents?.filter((component) => component.types?.includes("country"));
  if (components?.length) return components.some((component) =>
    [component.shortText, component.longText].some((text) => text && sameCountry(text, country)),
  );
  // Country-first Japanese addresses and country-last Western addresses are both common.
  return candidate.formattedAddress.split(/[,、，]/).flatMap((part) => [part, ...part.split(/[-−–—]/)]).some((part) => {
    const text = geographicText(part).split(" ").filter((word) => !/\d/.test(word)).join(" ");
    return sameCountry(text, country);
  });
}

function valid(candidate: GeocodeCandidate): boolean {
  const { lat, lng } = candidate;
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Conservative address heuristic: a house number or street word beyond city/country/postcode. */
export function hasStreetAddress(input: { address: string; city: string; country?: string | null }): boolean {
  let address = normalizeText(input.address);
  const areas = [input.city, input.country ?? "", ...COUNTRY_GROUPS.flat()];
  for (const area of areas) {
    const normalized = normalizeText(area);
    if (normalized) address = (` ${address} `).split(` ${normalized} `).join(" ").trim();
  }
  // Postcodes are not house numbers. Prefer false negatives to invented map pins.
  address = address.replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/gi, " ").replace(/\b\d{5,6}(?: \d{4})?\b/g, " ");
  const country = normalizeText(input.country ?? "");
  if (["australia", "au", "austria", "at", "new zealand", "nz", "belgium", "denmark", "norway", "switzerland", "south africa"].includes(country))
    address = address.replace(/\b\d{4}\b/g, " ");
  address = address.replace(/\b\d{4}\s*[a-z]{2}\b/gi, " ");
  const house = /\b\d{1,4}[a-z]?\b/i.test(address) && /\p{L}{4,}/u.test(address);
  return house || /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|rue|strasse|calle|jalan|marg)\b/i.test(address);
}

/** Area and route results never identify a venue, even with a convincing formatted address. */
export function hasStreetLevelTypes(types: readonly string[] | undefined): boolean {
  if (!types?.length) return false;
  if (types.some((type) => /^(locality|sublocality.*|administrative_area_level_.*|postal_code.*|postal_town|country|political|colloquial_area|neighborhood|route)$/.test(type))) return false;
  return types.some((type) => !["point_of_interest", "geocode"].includes(type));
}

/** Apply the rule above. */
export function judgeGeocode(results: readonly GeocodeCandidate[], expected: { city: string; country?: string | null }): GeocodeVerdict {
  const usable = results.filter(valid);
  const [top] = usable;
  if (!top) return { ok: false, reason: "no_result" };
  if (!hasStreetLevelTypes(top.types)) return { ok: false, reason: "not_street_level" };
  if (usable.slice(1).some((other) => distanceMeters(top, other) > AMBIGUOUS_SPREAD_METERS)) return { ok: false, reason: "ambiguous" };
  if (!matchesCity(top, expected.city)) return { ok: false, reason: "wrong_city" };
  if (expected.country && !matchesCountry(top, expected.country)) return { ok: false, reason: "wrong_country" };
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
