/**
 * find_place and upsert_place for the Scout importer.
 *
 * Candidates come from one bounded query: places whose name contains one of
 * the query's distinctive words (instr(), never LIKE: D1 caps LIKE patterns at
 * 50 bytes) and that sit inside the search radius's box or in the same city.
 * lib/core/place-candidates.ts ranks them.
 *
 * upsert_place treats a candidate at SAME_PLACE_SCORE or above as the place,
 * fills its empty columns and repairs eligible Scout pins, or lists a new place at once as
 * "Not checked yet", the same as a person adding one from Google Maps (the
 * pending-review hold from #58 was retired with the four-fact redesign).
 * Scout-created places carry no submitter, no points and no check.
 *
 * lat/lng are optional. Without them, matching uses the city and street
 * address, and a new place (or a matched one with no coordinates) is
 * geocoded through ./geocode.ts. Eligible Scout pins can also be relocated. When that isn't confident the place is
 * stored without coordinates: it is listed on its city page and in search,
 * but has no map pin, distance or Nearby, and its page says the location is
 * pending. Coordinates are never guessed. `location` in the result says which
 * happened.
 *
 * `force_new` skips matching, for a stall inside a food hall that the
 * matcher would otherwise take for the hall. It still can't create a second
 * row with the same city, name and street address, or the same Google id:
 * that returns `duplicate_place` with the existing id.
 *
 * Both paths then apply the optional sourced attributes (halal_certified,
 * muslim_owned, no_pork, no_alcohol) as web claims (./claims.ts): they fill
 * facts nobody has answered, replace Scout's own older claims, and never
 * override community checks or approved certificates and menus.
 */
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { placeIdParam } from "@/lib/core/params";
import { hasStreetAddress } from "@/lib/core/geocode-confidence";
import { locationSource, type LocationSource } from "@/lib/core/location-source";
import { ingestRejection } from "@/lib/core/ingest-filters";
import {
  clampRadius,
  DEFAULT_RADIUS_METERS,
  MAX_RADIUS_METERS,
  nameSearchTerms,
  rankCandidates,
  SAME_PLACE_SCORE,
  boundingBox,
  type CandidateRow,
  type LatLng,
  type PlaceQuery,
  type RankedCandidate,
} from "@/lib/core/place-candidates";
import { slugifyCity } from "@/lib/core/place-submission";
import { runBatch } from "@/lib/checks-repository";
import { googlePlaceMapsUrl } from "@/lib/google-places";
import { publishListingChange } from "@/lib/listing-cache";
import { cityName, parseCuisines } from "@/lib/place-view";
import { createPlaceStatements, findPlaceByGoogleId } from "@/lib/places";
import { containsText } from "@/lib/text-search";
import { applyClaims, claimAttributesInput, type ClaimOutcomes } from "./claims";
import type { ScoutDeps } from "./deps";
import { geocodePlace, type GeocodeFailure } from "./geocode";

/** Rows read per lookup before ranking. */
const CANDIDATE_ROWS = 200;
export const MAX_FIND_RESULTS = 10;

const text = (max: number) => z.string().trim().min(1).max(max);
const googlePlaceId = z
  .string()
  .trim()
  .min(8)
  .max(300)
  .regex(/^[A-Za-z0-9_-]+$/, "A Google place id is letters, numbers, _ and -.");

export const findPlaceInput = z
  .object({
    name: text(200).describe("The place's name as the video or listing gives it."),
    city: text(80).optional().describe("City name, e.g. London. Needed when lat/lng are not sent."),
    country: text(80).optional(),
    address: text(300).optional().describe("Street address; a matching street raises the score."),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    radius_m: z.number().int().min(1).max(MAX_RADIUS_METERS).optional().describe(`Search radius around lat/lng in metres. Default ${DEFAULT_RADIUS_METERS}, max ${MAX_RADIUS_METERS}.`),
    google_place_id: googlePlaceId.optional(),
    limit: z.number().int().min(1).max(MAX_FIND_RESULTS).optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), { message: "Send lat and lng together." })
  .refine((value) => value.city !== undefined || value.lat !== undefined || value.google_place_id !== undefined, {
    message: "Send a city, or lat and lng, so the search has a place to look.",
  });
export type FindPlaceInput = z.infer<typeof findPlaceInput>;

export const upsertPlaceInput = z.object({
  name: text(120),
  address: text(200).describe("Full street address, e.g. 7 Boundary St, London E2 7JE."),
  city: text(80),
  country: text(80),
  lat: z.number().min(-90).max(90).optional().describe("Send with lng. Without both, the place is geocoded from address, city and country."),
  lng: z.number().min(-180).max(180).optional(),
  google_place_id: googlePlaceId.optional(),
  place_id: z.string().trim().refine((value) => Boolean(placeIdParam(value)), "Send a valid place id.").optional().describe("Exact existing place to repair; requires relocate: true and cannot be combined with force_new."),
  relocate: z.boolean().optional().describe("Explicitly replace a Scout pin, including an unknown-source legacy pin only when its Scout creation audit exists. Protected sources are never overwritten."),
  force_new: z.boolean().optional().describe("Skip matching and always list a new place, e.g. a stall inside a food hall that matched the hall."),
  website: z.string().trim().max(500).optional().describe("https URL of the place's own site."),
  cuisine: z.union([text(60), z.array(text(60)).max(8)]).optional(),
  google_types: z.array(text(60)).max(30).optional().describe("Google place types, if known: used only by the ingest filters (bar, pub, …)."),
  description: z.string().max(2000).optional().describe("Used only by the ingest filters; not stored."),
  ...claimAttributesInput,
}).refine((value) => (value.lat === undefined) === (value.lng === undefined), { message: "Send lat and lng together, or neither." }).refine((value) => !value.place_id || (value.relocate === true && !value.force_new), { message: "place_id requires relocate: true without force_new." });
export type UpsertPlaceInput = z.infer<typeof upsertPlaceInput>;

/**
 * Where the place's coordinates came from in this call: the input, Google, the
 * matched row (untouched), or nowhere (stored without them).
 */
export type LocationOutcome = "provided" | "geocoded" | "existing" | "null" | "relocated";
type LocationSnapshot = { lat: number | null; lng: number | null; source: LocationSource | null };
type AddressOutcome = { address_updated?: true; address_change?: { previous: string; current: string }; address_refused?: "protected_source" | "location_changed" | "duplicate_place" };
type Located = AddressOutcome & { location: LocationOutcome; geocode?: GeocodeFailure; previous?: LocationSnapshot; current?: LocationSnapshot; relocate_refused?: "protected_source" | "no_street_address" | "not_more_precise" | "location_changed" | GeocodeFailure };

type PlaceRow = CandidateRow & {
  locationSource: LocationSource | null;
  addressCountry: string | null;
  listingStatus: string;
  website: string | null;
};

export type PlaceSummary = {
  id: string;
  name: string;
  address: string;
  city: string;
  city_slug: string;
  country: string | null;
  lat: number | null;
  lng: number | null;
  listing_status: string;
  url: string;
};

export type FoundPlace = PlaceSummary & { score: number; distance_m: number | null; matched_by: RankedCandidate<PlaceRow>["matchedBy"] | "place_id" };

export type Rejection = { ok: false; error: "rejected"; rejected: "ahmadiyya" | "alcohol_led"; reason: string; message: string };
export type PlaceFailure = { ok: false; error: string; message: string } | Rejection;

export type UpsertPlaceResult =
  | ({ ok: true; result: "created"; place: PlaceSummary; attributes: ClaimOutcomes } & Located)
  | ({ ok: true; result: "matched"; place: PlaceSummary; matched_by: FoundPlace["matched_by"]; score: number; filled: string[]; attributes: ClaimOutcomes } & Located)
  | { ok: false; error: "duplicate_place"; message: string; existing_place_id: string }
  | PlaceFailure;

function toRow(row: Record<string, unknown>): PlaceRow {
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    locationSource: locationSource(row.location_source),
    id: String(row.id),
    name: String(row.name),
    citySlug: String(row.city_slug),
    streetAddress: String(row.street_address ?? ""),
    addressLocality: (row.address_locality as string | null) ?? null,
    addressCountry: (row.address_country as string | null) ?? null,
    lat: num(row.lat),
    lng: num(row.lng),
    googlePlaceId: (row.google_place_id as string | null) ?? null,
    listingStatus: String(row.listing_status),
    website: (row.website as string | null) ?? null,
  };
}

export function placeSummary(origin: string, row: PlaceRow): PlaceSummary {
  return {
    id: row.id,
    name: row.name,
    address: row.streetAddress,
    city: row.addressLocality ?? cityName(row.citySlug),
    city_slug: row.citySlug,
    country: row.addressCountry,
    lat: row.lat,
    lng: row.lng,
    listing_status: row.listingStatus,
    url: `${origin}/place/${row.id}`,
  };
}

const COLUMNS = sql`p.id, p.name, p.city_slug, p.street_address, p.address_locality, p.address_country, p.lat, p.lng,
  p.google_place_id, p.listing_status, p.website, p.location_source`;

async function candidateRows(deps: ScoutDeps, query: PlaceQuery): Promise<PlaceRow[]> {
  const terms = nameSearchTerms(query.name);
  const where: SQL[] = [];
  if (terms.length) {
    // One lower-case spelling per word keeps the bound parameters well under D1's 100.
    const named = sql`(${sql.join(terms.map((term) => containsText(sql`p.name`, term, 2)), sql` OR `)})`;
    if (query.location) {
      const box = boundingBox(query.location, query.radiusMeters);
      where.push(sql`(p.lat BETWEEN ${box.minLat} AND ${box.maxLat} AND p.lng BETWEEN ${box.minLng} AND ${box.maxLng} AND ${named})`);
    }
    if (query.citySlug || query.city)
      where.push(sql`((p.city_slug = ${query.citySlug ?? ""} OR lower(p.address_locality) = lower(${query.city ?? ""})) AND ${named})`);
  }
  if (query.googlePlaceId) where.push(sql`p.google_place_id = ${query.googlePlaceId}`);
  if (!where.length) return [];
  const rows = await deps.db.all<Record<string, unknown>>(sql`
    SELECT ${COLUMNS} FROM places p WHERE ${sql.join(where, sql` OR `)} ORDER BY p.id LIMIT ${CANDIDATE_ROWS}
  `);
  return rows.map(toRow);
}

function placeQuery(input: { name: string; city?: string; address?: string; lat?: number; lng?: number; radius_m?: number; google_place_id?: string }): PlaceQuery {
  return {
    name: input.name,
    city: input.city ?? null,
    citySlug: input.city ? slugifyCity(input.city) || null : null,
    address: input.address ?? null,
    location: input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : null,
    radiusMeters: clampRadius(input.radius_m),
    googlePlaceId: input.google_place_id ?? null,
  };
}

async function rankedPlaces(deps: ScoutDeps, query: PlaceQuery, limit: number) {
  return rankCandidates(query, await candidateRows(deps, query), limit);
}

function found(origin: string, ranked: RankedCandidate<PlaceRow>): FoundPlace {
  return { ...placeSummary(origin, ranked), score: ranked.score, distance_m: ranked.distanceMeters, matched_by: ranked.matchedBy };
}

/** Ranked candidates for a name near a location. Every listing status is included; check listing_status. */
export async function findPlace(deps: ScoutDeps, input: FindPlaceInput): Promise<{ ok: true; candidates: FoundPlace[]; same_place_score: number }> {
  const ranked = await rankedPlaces(deps, placeQuery(input), input.limit ?? 5);
  return { ok: true, candidates: ranked.map((row) => found(deps.origin, row)), same_place_score: SAME_PLACE_SCORE };
}

export function rejectionFor(input: { name: string; description?: string | null; types?: readonly string[] }): Rejection | null {
  const rejection = ingestRejection(input);
  return rejection ? { ok: false, error: "rejected", ...rejection, message: rejection.reason } : null;
}

/** A listed place that Scout attaches something to (a verification, a menu, a logo). */
export type TargetPlace = { id: string; name: string; citySlug: string };

/**
 * Resolve a tool's place_id the same way for every tool that attaches to a
 * place: a valid id, a place that exists, isn't alcohol-led or Ahmadiyya, and
 * is listed.
 */
export async function targetPlace(deps: ScoutDeps, rawId: string): Promise<{ ok: true; place: TargetPlace } | PlaceFailure> {
  const placeId = placeIdParam(rawId);
  if (!placeId) return { ok: false, error: "invalid_place_id", message: "place_id is the id from find_place or upsert_place." };
  const [place] = await deps.db.all<{ id: string; name: string; city_slug: string; serves_cuisine: unknown; listing_status: string }>(sql`
    SELECT id, name, city_slug, serves_cuisine, listing_status FROM places WHERE id = ${placeId} LIMIT 1
  `);
  if (!place) return { ok: false, error: "place_not_found", message: "No place has that id." };
  const rejected = rejectionFor({ name: place.name, types: parseCuisines(place.serves_cuisine) });
  if (rejected) return rejected;
  if (place.listing_status !== "listed")
    return { ok: false, error: "place_not_listed", message: `That place is ${place.listing_status}, so Scout can't add to it.` };
  return { ok: true, place: { id: place.id, name: place.name, citySlug: place.city_slug } };
}

function cuisines(value: UpsertPlaceInput["cuisine"]): string[] {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return [...new Set(list.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 8);
}

function httpsWebsite(value: string | undefined): string | null | "invalid" {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "invalid";
  } catch {
    return "invalid";
  }
}

async function placeById(deps: ScoutDeps, id: string): Promise<PlaceRow | null> {
  const [row] = await deps.db.all<Record<string, unknown>>(sql`SELECT ${COLUMNS} FROM places p WHERE p.id = ${id} LIMIT 1`);
  return row ? toRow(row) : null;
}

/** Fill a matched place's empty columns. Never overwrites what is there. */
async function fillBlanks(deps: ScoutDeps, place: PlaceRow, input: UpsertPlaceInput, website: string | null): Promise<string[]> {
  const filled: string[] = [];
  const sets: SQL[] = [];
  if (!place.addressCountry) {
    sets.push(sql`address_country = ${input.country}`);
    filled.push("country");
  }
  if (!place.addressLocality) {
    sets.push(sql`address_locality = ${input.city}`);
    filled.push("city");
  }
  if (!place.website && website) {
    sets.push(sql`website = ${website}`);
    filled.push("website");
  }
  if (sets.length) await deps.db.run(sql`UPDATE places SET ${sql.join(sets, sql`, `)}, updated_at = ${deps.now()} WHERE id = ${place.id}`);
  if (!place.googlePlaceId && input.google_place_id) {
    try {
      await deps.db.run(sql`UPDATE places SET google_place_id = ${input.google_place_id} WHERE id = ${place.id} AND google_place_id IS NULL`);
      filled.push("google_place_id");
    } catch {
      // Another place already has that Google id. Leave both as they are.
    }
  }
  return filled;
}

export async function upsertPlace(deps: ScoutDeps, input: UpsertPlaceInput): Promise<UpsertPlaceResult> {
  const servesCuisine = cuisines(input.cuisine);
  const rejected = rejectionFor({ name: input.name, description: input.description, types: [...(input.google_types ?? []), ...servesCuisine] });
  if (rejected) return rejected;
  const citySlug = slugifyCity(input.city);
  if (!citySlug) return { ok: false, error: "invalid_city", message: "That city name has no letters or numbers to make a city page from." };
  const website = httpsWebsite(input.website);
  if (website === "invalid") return { ok: false, error: "invalid_website", message: "Websites must be https URLs." };

  const provided: LatLng | null = input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : null;
  const geocode = () => geocodePlace(deps, { address: input.address, city: input.city, country: input.country, googlePlaceId: input.google_place_id });

  const matched = async (row: PlaceRow, by: FoundPlace["matched_by"], score: number): Promise<UpsertPlaceResult> => {
    const missing = row.lat === null || row.lng === null;
    const owned = row.locationSource === "scout" || row.locationSource === "geocoded";
    // Claims/verifications can be attached to imported or community places too.
    const [legacy] = input.relocate && row.locationSource === null && !missing
      ? await deps.db.all<{ id: string }>(sql`
          SELECT p.id FROM places p WHERE p.id = ${row.id} AND p.submitted_by_user_id IS NULL
          AND EXISTS (SELECT 1 FROM audit_log a WHERE a.actor_user_id = 'mcp:scout'
            AND a.action = 'listing.changed' AND a.target_type = 'listing' AND a.target_id = 'directory'
            AND json_valid(a.after_value)
            AND json_extract(a.after_value, '$.change') = 'place-added'
            AND json_extract(a.after_value, '$.placeId') = p.id) LIMIT 1
        `) : [];
    const permitted = (row.lat === null && row.lng === null) || owned || Boolean(legacy);
    const precise = Boolean(provided) || hasStreetAddress(input);
    let located: Located = { location: "existing" };
    let coordinates: LatLng | null = null;
    let source: LocationSource | null = null;
    if (!permitted) located.relocate_refused = "protected_source";
    else if (!missing && !precise) located.relocate_refused = "no_street_address";
    else {
      if (provided) {
        coordinates = provided;
        source = "scout";
        located = { location: "provided" };
      } else {
        const found = await geocode();
        if (found.ok) {
          coordinates = found;
          source = "geocoded";
          located = { location: "geocoded" };
        } else located = missing ? { location: "null", geocode: found.reason } : { location: "existing", geocode: found.reason, relocate_refused: found.reason };
      }
      // Explicit coordinates establish precision; geocoding repairs a city-only
      // address or an earlier geocode. Replacing an explicit Scout pin with a
      // geocode of an already street-level address needs the deliberate override.
      if (coordinates && !missing && !input.relocate && !provided && row.locationSource === "scout" && hasStreetAddress({ address: row.streetAddress, city: row.addressLocality ?? input.city, country: row.addressCountry })) {
        coordinates = null;
        located = { location: "existing", relocate_refused: "not_more_precise" };
      }
    }
    const filled = await fillBlanks(deps, row, input, website);
    if (coordinates) {
      const updated = await deps.db.all<{ id: string }>(sql`
        UPDATE places SET lat = ${coordinates.lat}, lng = ${coordinates.lng}, location_source = ${source},
          maps_url = ${row.googlePlaceId ? googlePlaceMapsUrl(row.googlePlaceId) : `https://www.google.com/maps/search/?api=1&query=${coordinates.lat},${coordinates.lng}`}, updated_at = ${deps.now()}
        WHERE id = ${row.id} AND lat IS ${row.lat} AND lng IS ${row.lng} AND location_source IS ${row.locationSource} AND street_address IS ${row.streetAddress}
        RETURNING id
      `);
      if (!updated.length) {
        coordinates = null;
        located = { location: "existing", relocate_refused: "location_changed" };
      } else if (missing) filled.push("lat", "lng");
      else located = { location: "relocated", previous: { lat: row.lat, lng: row.lng, source: row.locationSource }, current: { lat: coordinates.lat, lng: coordinates.lng, source } };
    }
    const addressResult: AddressOutcome = {};
    const address = input.address.replace(/\s+/g, " ");
    if (hasStreetAddress(input) && address !== row.streetAddress) {
      // Missing coordinates allow filling a pin, but never grant ownership of a protected address.
      if (!permitted || (!owned && row.locationSource !== null)) addressResult.address_refused = "protected_source";
      else if (located.relocate_refused === "location_changed") addressResult.address_refused = "location_changed";
      else {
        try {
          const updated = await deps.db.all<{ id: string }>(sql`
            UPDATE places SET street_address = ${address}, updated_at = ${deps.now()}
              ${!coordinates && row.lat === null && row.lng === null && !row.googlePlaceId && !input.google_place_id
                ? sql`, maps_url = ${`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.name}, ${address}, ${input.city}, ${input.country}`)}`}` : sql``}
            WHERE id = ${row.id} AND street_address IS ${row.streetAddress}
              AND lat IS ${coordinates ? coordinates.lat : row.lat} AND lng IS ${coordinates ? coordinates.lng : row.lng}
              AND location_source IS ${coordinates ? source : row.locationSource}
            RETURNING id
          `);
          if (updated.length) {
            filled.push("street_address");
            addressResult.address_updated = true;
            addressResult.address_change = { previous: row.streetAddress, current: address };
          } else addressResult.address_refused = "location_changed";
        } catch (error) {
          if (!(error instanceof Error && [error.message, error.cause instanceof Error ? error.cause.message : ""].some((message) => /unique/i.test(message)))) throw error;
          addressResult.address_refused = "duplicate_place";
        }
      }
    }
    const claims = await applyClaims(deps, row.id, input);
    // Claims and location/address repairs change cached listings.
    if (claims.changed || coordinates || addressResult.address_updated)
      await publishListingChange({ actorUserId: "mcp:scout", change: "place-claims", placeId: row.id, citySlug: row.citySlug }, deps.db).catch(() => null);
    return { ok: true, result: "matched", place: placeSummary(deps.origin, (await placeById(deps, row.id)) ?? row), matched_by: by, score, filled, attributes: claims.outcomes, ...located, ...addressResult };
  };

  const name = input.name.replace(/\s+/g, " ");
  const address = input.address.replace(/\s+/g, " ");
  const duplicate = async (): Promise<UpsertPlaceResult | null> => {
    const [row] = await deps.db.all<{ id: string }>(sql`
      SELECT id FROM places
      WHERE (city_slug = ${citySlug} AND name = ${name} AND street_address = ${address})
        ${input.google_place_id ? sql`OR google_place_id = ${input.google_place_id}` : sql``}
      LIMIT 1
    `);
    return row
      ? {
          ok: false,
          error: "duplicate_place",
          existing_place_id: row.id,
          message: "force_new: a place with this city, name and street address (or this Google id) is already listed. Use existing_place_id, or change the name or address.",
        }
      : null;
  };

  if (input.place_id) {
    const row = await placeById(deps, placeIdParam(input.place_id)!);
    if (!row) return { ok: false, error: "place_not_found", message: "That place is no longer listed. Check the place id." };
    return matched(row, "place_id", 1);
  }

  if (input.force_new) {
    const taken = await duplicate();
    if (taken) return taken;
  } else {
    if (input.google_place_id) {
      const byGoogle = await findPlaceByGoogleId(input.google_place_id, deps.db);
      const row = byGoogle ? await placeById(deps, byGoogle.id) : null;
      if (row) return matched(row, "google_place_id", 1);
    }
    const [best] = await rankedPlaces(deps, placeQuery(input), 1);
    if (best && best.score >= SAME_PLACE_SCORE) return matched(best, best.matchedBy, best.score);
  }

  let coordinates = provided;
  let located: Located = { location: provided ? "provided" : "null" };
  if (!provided) {
    const found = await geocode();
    if (found.ok) [coordinates, located] = [{ lat: found.lat, lng: found.lng }, { location: "geocoded" }];
    else located = { location: "null", geocode: found.reason };
  }

  const id = crypto.randomUUID();
  const now = deps.now();
  try {
    await runBatch(deps.db, [
      ...createPlaceStatements(
        {
          name,
          citySlug,
          streetAddress: address,
          addressLocality: input.city,
          addressCountry: input.country,
          mapsUrl: input.google_place_id
            ? googlePlaceMapsUrl(input.google_place_id)
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates ? `${coordinates.lat},${coordinates.lng}` : `${name}, ${address}, ${input.city}, ${input.country}`)}`,
          googlePlaceId: input.google_place_id ?? null,
          servesCuisine,
          locationSource: coordinates ? provided ? "scout" : "geocoded" : null,
          lat: coordinates?.lat ?? null,
          lng: coordinates?.lng ?? null,
          submittedByUserId: null,
        },
        id,
        now,
      ),
      ...(website ? [sql`UPDATE places SET website = ${website} WHERE id = ${id}`] : []),
    ]);
  } catch (error) {
    if (!/unique/i.test(error instanceof Error ? error.message : String(error))) throw error;
    // Same city, name and street, or the same Google id, written a moment ago.
    const taken = await duplicate();
    if (taken && input.force_new) return taken;
    const row = taken && !taken.ok && "existing_place_id" in taken ? await placeById(deps, taken.existing_place_id) : null;
    if (row) return matched(row, input.google_place_id && row.googlePlaceId === input.google_place_id ? "google_place_id" : "name_and_address", 1);
    throw error;
  }
  const { outcomes: attributes } = await applyClaims(deps, id, input);
  // New places change city counts and sitemaps; never fail the write over it.
  await publishListingChange({ actorUserId: "mcp:scout", change: "place-added", placeId: id, citySlug }, deps.db).catch(() => null);
  const row = await placeById(deps, id);
  return { ok: true, result: "created", place: placeSummary(deps.origin, row!), attributes, ...located };
}
