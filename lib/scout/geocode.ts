/**
 * Coordinates for a Scout place sent without lat/lng, from the Google Places
 * key the site already uses for add-a-place search. A Google place id is
 * looked up with Place Details (address and location only); otherwise the
 * street, city and country go to Text Search. Each call first reserves one
 * unit of the same D1 daily caps as add-a-place search (`details:` and the
 * search day), so Scout can never run up a bill the caps don't allow.
 *
 * lib/core/geocode-confidence.ts decides whether to trust the answer. When
 * it doesn't, or there is no key, no budget or no answer, the place gets no
 * coordinates: never a guess.
 */
import { judgeGeocode, geocodeQuery, hasStreetAddress, type GeocodeCandidate, type GeocodeRejection } from "@/lib/core/geocode-confidence";
import { getGooglePlaceDetails, searchGooglePlaces, GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK } from "@/lib/google-places";
import { d1GoogleSearchBudget } from "@/lib/google-search-budget";
import type { ScoutDeps } from "./deps";

export type GeocodeFailure = "no_street_address" | "not_configured" | "budget_exhausted" | "provider_error" | GeocodeRejection;

export type Geocoded = { ok: true; lat: number; lng: number; via: "google_place_id" | "text_search" } | { ok: false; reason: GeocodeFailure };

export type GeocodeInput = { address: string; city: string; country?: string | null; googlePlaceId?: string | null };

/** Geocode one place, spending at most one Google call. */
export async function geocodePlace(deps: ScoutDeps, input: GeocodeInput): Promise<Geocoded> {
  if (!hasStreetAddress(input)) return { ok: false, reason: "no_street_address" };
  const apiKey = deps.google?.apiKey;
  if (!deps.google || !apiKey) return { ok: false, reason: "not_configured" };
  const now = new Date(deps.now());
  const budget = d1GoogleSearchBudget(deps.db);
  const expected = { city: input.city, country: input.country };

  if (input.googlePlaceId) {
    if (!(await budget.tryConsume(deps.google.detailsCap, now, "details").catch(() => false))) return { ok: false, reason: "budget_exhausted" };
    const details = await getGooglePlaceDetails(input.googlePlaceId, { apiKey, fieldMask: "formattedAddress,location,types,addressComponents" });
    if (!details.ok) return { ok: false, reason: "provider_error" };
    const candidates: GeocodeCandidate[] = details.coordinates
      ? [{ formattedAddress: details.place.formattedAddress ?? "", types: details.place.types, addressComponents: details.place.addressComponents, ...details.coordinates }]
      : [];
    return verdict(candidates, expected, "google_place_id");
  }

  if (!(await budget.tryConsume(deps.google.searchCap, now, "search").catch(() => false))) return { ok: false, reason: "budget_exhausted" };
  const found = await searchGooglePlaces(geocodeQuery({ address: input.address, city: input.city, country: input.country }), { apiKey, fieldMask: `${GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK},places.addressComponents` });
  if (!found.ok) return { ok: false, reason: "provider_error" };
  const candidates = found.places.flatMap((place) =>
    place.location ? [{ formattedAddress: place.formattedAddress, types: place.types, addressComponents: place.addressComponents, lat: place.location.latitude, lng: place.location.longitude }] : [],
  );
  return verdict(candidates, expected, "text_search");
}

function verdict(candidates: GeocodeCandidate[], expected: { city: string; country?: string | null }, via: "google_place_id" | "text_search"): Geocoded {
  const judged = judgeGeocode(candidates, expected);
  return judged.ok ? { ok: true, lat: judged.lat, lng: judged.lng, via } : judged;
}
