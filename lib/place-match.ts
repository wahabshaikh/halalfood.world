import { slugifyCity } from "@/lib/core/place-submission";

/*
 * Pure name and address matching for duplicate places. Shared by the server
 * (POST /api/places, Google search) and /add, which flags a picked Google
 * result that matches an "Already listed" place.
 */

/** Words too common in venue names to show two names are the same venue. */
const COMMON_NAME_WORDS = new Set([
  "the", "and", "halal", "food", "foods", "restaurant", "restaurants", "cafe", "café",
  "kitchen", "grill", "takeaway", "house", "express", "ltd", "limited", "bar", "shop",
]);

export function lowerSpaced(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function compact(value: string): string {
  return lowerSpaced(value).replace(/[^a-z0-9]/g, "");
}

function nameWords(value: string, citySlug: string): string[] {
  const city = new Set(citySlug.split("-"));
  return lowerSpaced(value)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !COMMON_NAME_WORDS.has(word) && !city.has(word));
}

/**
 * Two names at the same street address name the same venue when one, without
 * the city, is inside the other ("Slam Burger Luton" and "Slamburger Halal Food
 * in Luton"), or they share a distinctive word.
 */
export function sameVenueName(a: string, b: string, citySlug: string): boolean {
  const city = compact(citySlug);
  const strip = (value: string) => (city ? compact(value).split(city).join("") : compact(value));
  const left = strip(a);
  const right = strip(b);
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  const words = new Set(nameWords(a, citySlug));
  return nameWords(b, citySlug).some((word) => words.has(word));
}

/**
 * The street part of a formatted address, in the forms a listed place stores it:
 * "180 Dunstable Rd" and "Unit 3, 12 High St" from "Unit 3, 12 High St, London E1, UK".
 */
export function streetAddressKeys(address: string): string[] {
  const parts = address
    .split(",")
    .map((part) => lowerSpaced(part))
    .filter(Boolean);
  if (parts.length === 0) return [];
  const keys = [parts[0]];
  if (parts.length >= 3) keys.push(`${parts[0]}, ${parts[1]}`);
  return keys.filter((key) => /\d/.test(key));
}

/** City slug from a Google formatted address, when the caller has no city. */
export function citySlugFromAddress(address: string): string {
  const parts = address
    .split(",")
    .map((part) => part.replace(/(?:\s|^)(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|\d{5}(?:-\d{4})?)$/i, "").trim())
    .filter(Boolean);
  const city = parts.length >= 3 ? parts[1] : parts.length === 2 ? (/\d/.test(parts[0]) ? parts[1] : parts[0]) : parts[0];
  return city ? slugifyCity(city) : "";
}


/**
 * The listed place a Google result duplicates: same street address in the
 * result's city and the same venue name. Used on /add with the "Already
 * listed" places from the text search.
 */
export function matchListedPlace<T extends { name: string; address: string }>(
  result: { name: string; address: string },
  listed: T[],
): T | null {
  const citySlug = citySlugFromAddress(result.address);
  const keys = new Set(streetAddressKeys(result.address));
  return (
    listed.find(
      (place) =>
        (lowerSpaced(place.name) === lowerSpaced(result.name) && Boolean(place.address) &&
          keys.has(lowerSpaced(place.address))) ||
        (Boolean(place.address) &&
          keys.has(lowerSpaced(place.address)) &&
          sameVenueName(place.name, result.name, citySlug)),
    ) ?? null
  );
}
