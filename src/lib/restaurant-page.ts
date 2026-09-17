import { sql } from "drizzle-orm";
import { database } from "../db";
import type { PlaceDetail } from "./places";
import {
  GOOGLE_PLACES_FIELD_MASK,
  enrichPlaceCoordinates,
  getGooglePlaceDetails,
  googlePlaceMapsUrl,
  type GooglePlaceCoordinates,
  type GooglePlaceDetails,
  type GooglePlaceDetailsResult,
} from "./google-places";
import { formatAddress } from "./seo";

/** Successful Google snapshots are deliberately long-lived to protect quota. */
export const GOOGLE_DETAILS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const COMMUNITY_LAYERS = [
  "save",
  "ratings",
  "reviews",
  "photos",
  "halal-verification",
] as const;

export type CommunityLayer = (typeof COMMUNITY_LAYERS)[number];

/** The normalized, non-secret subset persisted by the page cache. */
export type GoogleDetailsSnapshot = {
  displayName: string | null;
  formattedAddress: string | null;
  coordinates: GooglePlaceCoordinates | null;
};

export type GoogleCacheStatus =
  | "not-linked"
  | "cached"
  | "refreshed"
  | "stale-fallback"
  | "unavailable";

export type GoogleListingFacts = {
  linked: boolean;
  placeId: string | null;
  displayName: string;
  displayNameSource: "google" | "listing";
  formattedAddress: string | null;
  address: string;
  addressSource: "google" | "listing";
  ratingValue: string | null;
  reviewCount: number | null;
  telephone: string | null;
  website: string | null;
  mapsUrl: string | null;
  mapsSource: "listing" | "google" | null;
  cacheStatus: GoogleCacheStatus;
  cachedAt: string | null;
  note: string;
};

export type CommunityPageFacts = {
  placeId: string;
  source: string | null;
  halalConfirmed: boolean | null;
  layers: readonly CommunityLayer[];
  note: string;
};

export type RestaurantPageModel = {
  place: PlaceDetail;
  google: GoogleListingFacts;
  community: CommunityPageFacts;
};

export type GoogleDetailsCacheWrite = {
  placeId: string;
  googlePlaceId: string;
  cachedAt: string;
  snapshot: GoogleDetailsSnapshot;
};

export type RestaurantPageDependencies = {
  now?: () => Date;
  fetchGoogleDetails?: (
    placeId: string,
    options?: { fieldMask?: string },
  ) => Promise<GooglePlaceDetailsResult>;
  saveGoogleDetails?: (input: GoogleDetailsCacheWrite) => Promise<void>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coordinates(value: unknown): GooglePlaceCoordinates | null {
  const item = record(value);
  const lat = typeof item?.lat === "number" ? item.lat : item?.latitude;
  const lng = typeof item?.lng === "number" ? item.lng : item?.longitude;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  )
    return null;
  return { lat, lng };
}

function isoTimestamp(
  value: string | number | Date | null | undefined,
): string | null {
  if (value instanceof Date)
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isFinite(fromNumber.valueOf()) ? fromNumber.toISOString() : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

/** Parse a DB snapshot defensively so a corrupt cache cannot break a page. */
export function parseGoogleDetailsSnapshot(
  value: unknown,
): GoogleDetailsSnapshot | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const item = record(raw);
  if (!item) return null;
  const hasSnapshotField =
    "displayName" in item || "formattedAddress" in item || "coordinates" in item;
  if (!hasSnapshotField) return null;
  return {
    displayName: nonEmptyString(item.displayName),
    formattedAddress: nonEmptyString(item.formattedAddress),
    coordinates: coordinates(item.coordinates ?? item.location),
  };
}

export function googleDetailsSnapshotFromPlace(
  place: GooglePlaceDetails,
  resultCoordinates?: GooglePlaceCoordinates | null,
): GoogleDetailsSnapshot {
  return {
    displayName: nonEmptyString(place.displayName?.text),
    formattedAddress: nonEmptyString(place.formattedAddress),
    coordinates:
      resultCoordinates ??
      (place.location
        ? { lat: place.location.latitude, lng: place.location.longitude }
        : null),
  };
}

export function isGoogleDetailsCacheFresh(
  cachedAt: string | Date | null | undefined,
  snapshot: GoogleDetailsSnapshot | null,
  now = new Date(),
) {
  const timestamp = isoTimestamp(cachedAt);
  if (!timestamp || !snapshot || !Number.isFinite(now.valueOf())) return false;
  return now.valueOf() - new Date(timestamp).valueOf() < GOOGLE_DETAILS_CACHE_TTL_MS;
}

export function googleCacheNote(status: GoogleCacheStatus): string {
  if (status === "not-linked")
    return "This listing uses our saved details; no Google Places listing is linked yet.";
  if (status === "cached" || status === "refreshed")
    return "Google Places Essentials details are cached for up to 7 days. Phone, website, rating, and review count use persisted listing data.";
  if (status === "stale-fallback")
    return "Google Places could not be refreshed, so the most recent saved Google details and listing facts remain visible.";
  return "Google Places is unavailable, so the saved listing facts remain visible.";
}

export function buildRestaurantPageModel(
  place: PlaceDetail,
  options: {
    snapshot?: GoogleDetailsSnapshot | null;
    cacheStatus?: GoogleCacheStatus;
    cachedAt?: string | Date | null;
  } = {},
): RestaurantPageModel {
  const googlePlaceId = place.google_place_id?.trim() || null;
  const snapshot = options.snapshot ?? null;
  const displayName = snapshot?.displayName ?? place.name;
  const listingAddress = formatAddress(place);
  const address = snapshot?.formattedAddress || listingAddress;
  const mapsUrl =
    place.maps_url?.trim() ||
    (googlePlaceId ? googlePlaceMapsUrl(googlePlaceId) : null);
  const mapsSource = place.maps_url?.trim()
    ? ("listing" as const)
    : mapsUrl
      ? ("google" as const)
      : null;
  const mergedPlace: PlaceDetail = {
    ...place,
    name: displayName,
    maps_url: mapsUrl,
  };
  const cacheStatus =
    options.cacheStatus ??
    (googlePlaceId
      ? snapshot
        ? "cached"
        : "unavailable"
      : "not-linked");
  const cachedAt = isoTimestamp(options.cachedAt);

  return {
    place: mergedPlace,
    google: {
      linked: Boolean(googlePlaceId),
      placeId: googlePlaceId,
      displayName,
      displayNameSource: snapshot?.displayName ? "google" : "listing",
      formattedAddress: snapshot?.formattedAddress ?? null,
      address,
      addressSource: snapshot?.formattedAddress ? "google" : "listing",
      ratingValue: place.rating_value,
      reviewCount: place.review_count,
      telephone: place.telephone,
      website: place.website,
      mapsUrl,
      mapsSource,
      cacheStatus,
      cachedAt,
      note: googleCacheNote(cacheStatus),
    },
    community: {
      placeId: place.id,
      source: place.source,
      halalConfirmed: place.halal_confirmed,
      layers: COMMUNITY_LAYERS,
      note: "Halal status is community-submitted verification evidence; listing facts come from public sources. Add a dated photo, a visit note, or a source link so the next diner can judge the claim.",
    },
  };
}

type CachedGoogleDetails = {
  cachedAt: string | null;
  snapshot: GoogleDetailsSnapshot | null;
};

function cachedGoogleDetails(place: PlaceDetail): CachedGoogleDetails {
  return {
    cachedAt: isoTimestamp(place.google_details_cached_at),
    snapshot: parseGoogleDetailsSnapshot(place.google_details_snapshot),
  };
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/** Persist only normalized Google fields; the API key and raw response never enter D1. */
export async function saveGoogleDetailsCache(
  input: GoogleDetailsCacheWrite,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
) {
  const db = await client;
  await db.run(sql`
    UPDATE places
    SET google_details_cached_at = ${new Date(input.cachedAt).getTime()},
        google_details_snapshot = ${JSON.stringify(input.snapshot)}
    WHERE id = ${input.placeId}
      AND google_place_id = ${input.googlePlaceId}
  `);
}

/**
 * Assemble one canonical place model. Google is fetched only for an absent or
 * stale snapshot, and every provider failure falls back to database data.
 */
export async function assembleRestaurantPage(
  place: PlaceDetail,
  dependencies: RestaurantPageDependencies = {},
): Promise<RestaurantPageModel> {
  const now = dependencies.now?.() ?? new Date();
  const googlePlaceId = place.google_place_id?.trim() || null;
  if (!googlePlaceId)
    return buildRestaurantPageModel(place, { cacheStatus: "not-linked" });

  const cache = cachedGoogleDetails(place);
  if (isGoogleDetailsCacheFresh(cache.cachedAt, cache.snapshot, now)) {
    const enriched = await enrichPlaceCoordinates(place, {
      coordinates: cache.snapshot?.coordinates ?? null,
    });
    return buildRestaurantPageModel(enriched, {
      snapshot: cache.snapshot,
      cacheStatus: "cached",
      cachedAt: cache.cachedAt,
    });
  }

  let result: GooglePlaceDetailsResult | null = null;
  try {
    result = await (dependencies.fetchGoogleDetails ?? getGooglePlaceDetails)(
      googlePlaceId,
      { fieldMask: GOOGLE_PLACES_FIELD_MASK },
    );
  } catch {
    // An injected provider or a future client change must not take down SSR.
  }

  if (result?.ok) {
    const snapshot = googleDetailsSnapshotFromPlace(result.place, result.coordinates);
    const cachedAt = now.toISOString();
    if (dependencies.saveGoogleDetails) {
      try {
        await dependencies.saveGoogleDetails({
          placeId: place.id,
          googlePlaceId,
          cachedAt,
          snapshot,
        });
      } catch {
        // Rendering the live result is more important than a cache write.
      }
    }
    const enriched = await enrichPlaceCoordinates(place, {
      coordinates: snapshot.coordinates,
    });
    return buildRestaurantPageModel(enriched, {
      snapshot,
      cacheStatus: "refreshed",
      cachedAt,
    });
  }

  const enriched = await enrichPlaceCoordinates(place, {
    coordinates: cache.snapshot?.coordinates ?? null,
  });
  return buildRestaurantPageModel(enriched, {
    snapshot: cache.snapshot,
    cacheStatus: cache.snapshot ? "stale-fallback" : "unavailable",
    cachedAt: cache.cachedAt,
  });
}
