/**
 * Add a place from a Google Maps result (spec §6.9). It goes live at once as
 * "Not checked yet", or "1 of 3" when the adder answered the questions, which
 * are stored as the place's first check.
 */
import { slugifyCity, type ValidatedPlaceSubmission } from "@/lib/core/place-submission";
import { validateCheck } from "@/lib/core/check";
import { hiddenListingReason } from "@/lib/core/listing-visibility";
import { database } from "@/lib/db";
import {
  GOOGLE_PLACES_ADD_FIELD_MASK,
  getGooglePlaceDetails,
  getGooglePlacesApiKey,
  googlePlaceLocality,
  googlePlaceMapsUrl,
  type GooglePlaceDetailsResult,
} from "./google-places";
import { reserveGoogleDetailsCall } from "./google-search-budget";
import { createPlaceStatements, findPlaceByGoogleId, type CreatePlaceInput } from "./places";
import { awardPoints, checkStatements, recomputePlaceStatus, runBatch } from "./checks-repository";

const POSTCODE_AT_END = /(?:\s|^)(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|\d{5}(?:-\d{4})?)$/i;

/**
 * City from a formatted address when Place Details did not run.
 * "1 High Street, London, UK" and "London, United Kingdom" both yield London.
 */
export function cityFromFormattedAddress(address: string): string | null {
  const parts = address
    .split(",")
    .map((part) => part.replace(POSTCODE_AT_END, "").replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0 && part.length <= 80 && slugifyCity(part));
  if (parts.length >= 3) return parts[1];
  if (parts.length === 2) return /\d/.test(parts[0]) ? parts[1] : parts[0];
  return parts[0] ?? null;
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export type AddPlaceDeps = {
  now?: () => number;
  reserve?: (now: Date) => Promise<boolean>;
  fetchDetails?: (placeId: string, options?: { fieldMask?: string }) => Promise<GooglePlaceDetailsResult>;
  hasApiKey?: () => boolean;
  client?: DatabaseClient | Promise<DatabaseClient>;
};

export type AddPlaceResult =
  | { ok: true; id: string; status: "unchecked" | "checking" }
  | { ok: false; status: number; error: string; existingId?: string };

const UNAVAILABLE = "Adding places is paused right now. Please try again later.";

/** Resolve the listing from Place Details, or from what was picked when the daily cap is spent. */
async function listingFor(
  input: ValidatedPlaceSubmission,
  deps: AddPlaceDeps,
  now: number,
): Promise<{ ok: true; listing: Omit<CreatePlaceInput, "submittedByUserId"> } | { ok: false; status: number; error: string }> {
  let allowed = false;
  try {
    allowed = await (deps.reserve ?? reserveGoogleDetailsCall)(new Date(now));
  } catch {
    allowed = false;
  }
  if (!allowed) {
    const name = input.name?.trim() || "";
    const address = input.address?.trim() || "";
    const city = input.city?.trim() || cityFromFormattedAddress(address);
    const citySlug = city ? slugifyCity(city) : "";
    if (!name || !address || !citySlug)
      return { ok: false, status: 422, error: "Google is busy right now. Please try again later." };
    return {
      ok: true,
      listing: {
        name,
        citySlug,
        streetAddress: address,
        addressLocality: null,
        addressCountry: null,
        mapsUrl: googlePlaceMapsUrl(input.googlePlaceId),
        googlePlaceId: input.googlePlaceId,
        servesCuisine: [],
        lat: null,
        lng: null,
      },
    };
  }
  if (!(deps.hasApiKey ?? (() => Boolean(getGooglePlacesApiKey())))())
    return { ok: false, status: 503, error: UNAVAILABLE };
  let details: GooglePlaceDetailsResult;
  try {
    details = await (deps.fetchDetails ?? getGooglePlaceDetails)(input.googlePlaceId, {
      fieldMask: GOOGLE_PLACES_ADD_FIELD_MASK,
    });
  } catch {
    return { ok: false, status: 502, error: "Google couldn’t confirm that place. Please try again." };
  }
  if (!details.ok)
    return details.code === "NOT_CONFIGURED"
      ? { ok: false, status: 503, error: UNAVAILABLE }
      : { ok: false, status: 502, error: "Google couldn’t confirm that place. Please try again." };
  const name = details.place.displayName?.text?.trim();
  const address = details.place.formattedAddress?.trim();
  if (!name || !address)
    return { ok: false, status: 422, error: "Google didn’t return enough details for that place. Try another result." };
  const city = googlePlaceLocality(details.place) ?? cityFromFormattedAddress(address);
  const citySlug = city ? slugifyCity(city) : "";
  if (!citySlug)
    return { ok: false, status: 422, error: "Google doesn’t say which city this place is in, so we can’t list it yet." };
  const googlePlaceId = details.place.id?.trim() || input.googlePlaceId;
  return {
    ok: true,
    listing: {
      name,
      citySlug,
      streetAddress: address,
      addressLocality: city,
      addressCountry: null,
      mapsUrl: googlePlaceMapsUrl(googlePlaceId),
      googlePlaceId,
      servesCuisine: [],
      lat: details.coordinates?.lat ?? null,
      lng: details.coordinates?.lng ?? null,
    },
  };
}

export async function addPlaceFromGoogle(
  userId: string,
  input: ValidatedPlaceSubmission,
  idempotencyKey: string,
  deps: AddPlaceDeps = {},
): Promise<AddPlaceResult> {
  const client = deps.client ?? database();
  const now = deps.now?.() ?? Date.now();
  // A place we already have costs no Google call.
  const existing = await findPlaceByGoogleId(input.googlePlaceId, client);
  if (existing)
    return { ok: false, status: 409, error: "That place is already listed.", existingId: existing.id };

  const resolved = await listingFor(input, deps, now);
  if (!resolved.ok) return resolved;
  const { listing } = resolved;
  if (listing.googlePlaceId && listing.googlePlaceId !== input.googlePlaceId) {
    const again = await findPlaceByGoogleId(listing.googlePlaceId, client);
    if (again) return { ok: false, status: 409, error: "That place is already listed.", existingId: again.id };
  }
  if (hiddenListingReason({ name: listing.name }))
    return { ok: false, status: 422, error: "This looks like a bar, so it can’t be listed here." };

  const id = crypto.randomUUID();
  const statements = [
    ...createPlaceStatements({ ...listing, submittedByUserId: userId }, id, now),
    awardPoints(userId, "place-added", id, listing.citySlug, null, now),
  ];
  let hasCheck = false;
  if (input.answers) {
    const check = validateCheck({ ...input.answers, idempotencyKey, shared: true });
    if (check.ok) {
      hasCheck = true;
      statements.push(...checkStatements(userId, id, listing.citySlug, check.value, crypto.randomUUID(), now));
    }
  }
  const db = await client;
  try {
    await runBatch(db, statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique constraint failed/i.test(message)) {
      const raced = listing.googlePlaceId ? await findPlaceByGoogleId(listing.googlePlaceId, db) : null;
      return { ok: false, status: 409, error: "That place is already listed.", existingId: raced?.id };
    }
    throw error;
  }
  if (!hasCheck) return { ok: true, id, status: "unchecked" };
  const recompute = await recomputePlaceStatus(id, db, now);
  return { ok: true, id, status: recompute.after.kind === "unchecked" ? "unchecked" : "checking" };
}
