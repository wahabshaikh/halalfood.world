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
import {
  d1GoogleSearchBudget,
  readGoogleDetailsDailyCap,
} from "./google-search-budget";

/** Successful Google snapshots are deliberately long-lived to protect quota. */
export const GOOGLE_DETAILS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cache-Control max-age for a Place Details payload. Same window as the D1 snapshot. */
export const GOOGLE_DETAILS_CACHE_TTL_SECONDS = GOOGLE_DETAILS_CACHE_TTL_MS / 1000;

/**
 * Google Maps Platform terms allow storing content for at most 30 days.
 * Place IDs themselves may be stored indefinitely; this limit is only the payload.
 */
export const GOOGLE_DETAILS_CONTENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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

export type GoogleDetailsCacheRecord = {
  cachedAt: string;
  snapshot: GoogleDetailsSnapshot;
};

/** Per Google place id. A hit must not call Place Details. */
export type GoogleDetailsCache = {
  get(googlePlaceId: string): Promise<GoogleDetailsCacheRecord | null>;
  set(
    googlePlaceId: string,
    record: GoogleDetailsCacheRecord,
    ttlSeconds: number,
  ): Promise<void>;
};

export type RestaurantPageDependencies = {
  now?: () => Date;
  fetchGoogleDetails?: (
    placeId: string,
    options?: { fieldMask?: string },
  ) => Promise<GooglePlaceDetailsResult>;
  saveGoogleDetails?: (input: GoogleDetailsCacheWrite) => Promise<void>;
  /** Defaults to isolate memory plus the Workers Cache API. */
  detailsCache?: GoogleDetailsCache;
  /**
   * Reserve one uncached Place Details call. False or a throw skips Google
   * and the page still renders.
   */
  reserveGoogleDetailsCall?: (now: Date) => Promise<boolean>;
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

function isoTimestamp(value: unknown): string | null {
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

function googleDetailsAgeMs(
  cachedAt: string | Date | null | undefined,
  snapshot: GoogleDetailsSnapshot | null,
  now: Date,
): number | null {
  const timestamp = isoTimestamp(cachedAt);
  if (!timestamp || !snapshot || !Number.isFinite(now.valueOf())) return null;
  return now.valueOf() - new Date(timestamp).valueOf();
}

export function isGoogleDetailsCacheFresh(
  cachedAt: string | Date | null | undefined,
  snapshot: GoogleDetailsSnapshot | null,
  now = new Date(),
) {
  const age = googleDetailsAgeMs(cachedAt, snapshot, now);
  return age !== null && age < GOOGLE_DETAILS_CACHE_TTL_MS;
}

/** True when the stored Google payload is still inside the 30-day content window. */
export function isGoogleDetailsContentAllowed(
  cachedAt: string | Date | null | undefined,
  snapshot: GoogleDetailsSnapshot | null,
  now = new Date(),
) {
  const age = googleDetailsAgeMs(cachedAt, snapshot, now);
  return age !== null && age < GOOGLE_DETAILS_CONTENT_MAX_AGE_MS;
}

/** Name, address, and coordinates are enough to render the page without Google. */
export function listingHasRenderableFacts(place: PlaceDetail): boolean {
  return Boolean(
    place.name?.trim() &&
      formatAddress(place) &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lng),
  );
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
      note: "Halal status is community-submitted verification evidence; halal reactions, dated photos, visit notes, and source links help the next diner judge the claim, while listing facts come from public sources.",
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

type WorkersCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

const DETAILS_CACHE_NAME = "halalfood-google-details";
const DETAILS_CACHE_ORIGIN = "https://google-details.halalfood.internal/";

function detailsEdgeRequest(googlePlaceId: string): Request {
  return new Request(DETAILS_CACHE_ORIGIN + encodeURIComponent(googlePlaceId));
}

async function openGoogleDetailsEdgeCache(): Promise<WorkersCache | null> {
  try {
    const storage = (globalThis as { caches?: { open?: (name: string) => Promise<WorkersCache> } })
      .caches;
    return typeof storage?.open === "function" ? await storage.open(DETAILS_CACHE_NAME) : null;
  } catch {
    return null;
  }
}

export function memoryGoogleDetailsCache(now: () => number = Date.now): GoogleDetailsCache {
  const store = new Map<string, { expiresAt: number; record: GoogleDetailsCacheRecord }>();
  return {
    async get(googlePlaceId) {
      const entry = store.get(googlePlaceId);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        store.delete(googlePlaceId);
        return null;
      }
      return entry.record;
    },
    async set(googlePlaceId, record, ttlSeconds) {
      store.set(googlePlaceId, { expiresAt: now() + ttlSeconds * 1000, record });
    },
  };
}

function parseDetailsCacheRecord(value: unknown): GoogleDetailsCacheRecord | null {
  const item = record(value);
  if (!item) return null;
  const cachedAt = isoTimestamp(item.cachedAt);
  const snapshot = parseGoogleDetailsSnapshot(item.snapshot);
  if (!cachedAt || !snapshot) return null;
  return { cachedAt, snapshot };
}

/**
 * Isolate memory plus the Workers Cache API. The named cache is not the
 * zone HTTP cache, so a public URL cannot read these Google payloads.
 */
export function layeredGoogleDetailsCache(
  memory: GoogleDetailsCache,
  openEdge: () => Promise<WorkersCache | null> = openGoogleDetailsEdgeCache,
): GoogleDetailsCache {
  return {
    async get(googlePlaceId) {
      const local = await memory.get(googlePlaceId);
      if (local) return local;
      const edge = await openEdge();
      if (!edge) return null;
      try {
        const hit = await edge.match(detailsEdgeRequest(googlePlaceId));
        if (!hit) return null;
        const parsed = parseDetailsCacheRecord(await hit.json());
        if (!parsed) return null;
        await memory.set(googlePlaceId, parsed, GOOGLE_DETAILS_CACHE_TTL_SECONDS);
        return parsed;
      } catch {
        return null;
      }
    },
    async set(googlePlaceId, value, ttlSeconds) {
      await memory.set(googlePlaceId, value, ttlSeconds);
      const edge = await openEdge();
      if (!edge) return;
      try {
        await edge.put(
          detailsEdgeRequest(googlePlaceId),
          Response.json(value, {
            headers: { "Cache-Control": `public, max-age=${ttlSeconds}` },
          }),
        );
      } catch {
        // A cache write must never fail the page.
      }
    },
  };
}

const sharedDetailsMemory = memoryGoogleDetailsCache();
let productionDetailsCache: GoogleDetailsCache | null = null;

export function productionGoogleDetailsCache(): GoogleDetailsCache {
  if (!productionDetailsCache) {
    productionDetailsCache = layeredGoogleDetailsCache(sharedDetailsMemory);
  }
  return productionDetailsCache;
}

async function reserveProductionGoogleDetailsCall(now: Date): Promise<boolean> {
  const cap = await readGoogleDetailsDailyCap();
  return d1GoogleSearchBudget().tryConsume(cap, now, "details");
}

async function readDetailsCache(
  cache: GoogleDetailsCache,
  googlePlaceId: string,
): Promise<GoogleDetailsCacheRecord | null> {
  try {
    return await cache.get(googlePlaceId);
  } catch {
    return null;
  }
}

async function writeDetailsCache(
  cache: GoogleDetailsCache,
  googlePlaceId: string,
  value: GoogleDetailsCacheRecord,
) {
  try {
    await cache.set(googlePlaceId, value, GOOGLE_DETAILS_CACHE_TTL_SECONDS);
  } catch {
    // A cache write must never fail the page.
  }
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

async function persistGoogleDetails(
  dependencies: RestaurantPageDependencies,
  placeId: string,
  googlePlaceId: string,
  record: GoogleDetailsCacheRecord,
) {
  if (!dependencies.saveGoogleDetails) return;
  try {
    await dependencies.saveGoogleDetails({
      placeId,
      googlePlaceId,
      cachedAt: record.cachedAt,
      snapshot: record.snapshot,
    });
  } catch {
    // Rendering the result is more important than a cache write.
  }
}

async function finishRestaurantPage(
  place: PlaceDetail,
  snapshot: GoogleDetailsSnapshot | null,
  cacheStatus: GoogleCacheStatus,
  cachedAt: string | null,
): Promise<RestaurantPageModel> {
  const enriched = await enrichPlaceCoordinates(place, {
    coordinates: snapshot?.coordinates ?? null,
  });
  return buildRestaurantPageModel(enriched, {
    snapshot,
    cacheStatus,
    cachedAt,
  });
}

function storedGoogleContent(
  stored: CachedGoogleDetails,
  now: Date,
): CachedGoogleDetails {
  if (!isGoogleDetailsContentAllowed(stored.cachedAt, stored.snapshot, now)) {
    return { cachedAt: null, snapshot: null };
  }
  return stored;
}

/**
 * Assemble one place page. Google Place Details is optional enrichment:
 * a warm cache, or a listing that already has a name, address, and location,
 * never calls Google. An uncached call for a thin listing reserves the daily
 * cap first. A cap, a cache failure, or a provider failure still renders.
 */
export async function assembleRestaurantPage(
  place: PlaceDetail,
  dependencies: RestaurantPageDependencies = {},
): Promise<RestaurantPageModel> {
  const now = dependencies.now?.() ?? new Date();
  const googlePlaceId = place.google_place_id?.trim() || null;
  if (!googlePlaceId)
    return buildRestaurantPageModel(place, { cacheStatus: "not-linked" });

  const stored = cachedGoogleDetails(place);
  if (isGoogleDetailsCacheFresh(stored.cachedAt, stored.snapshot, now)) {
    return finishRestaurantPage(place, stored.snapshot, "cached", stored.cachedAt);
  }

  const detailsCache = dependencies.detailsCache ?? productionGoogleDetailsCache();
  const cached = await readDetailsCache(detailsCache, googlePlaceId);
  if (
    cached &&
    isGoogleDetailsCacheFresh(cached.cachedAt, cached.snapshot, now) &&
    isGoogleDetailsContentAllowed(cached.cachedAt, cached.snapshot, now)
  ) {
    await persistGoogleDetails(dependencies, place.id, googlePlaceId, cached);
    return finishRestaurantPage(place, cached.snapshot, "cached", cached.cachedAt);
  }

  const usable = storedGoogleContent(stored, now);
  if (listingHasRenderableFacts(place)) {
    return finishRestaurantPage(
      place,
      usable.snapshot,
      usable.snapshot ? "stale-fallback" : "unavailable",
      usable.cachedAt,
    );
  }

  const reserve = dependencies.reserveGoogleDetailsCall ?? reserveProductionGoogleDetailsCall;
  let allowed = false;
  try {
    allowed = await reserve(now);
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return finishRestaurantPage(
      place,
      usable.snapshot,
      usable.snapshot ? "stale-fallback" : "unavailable",
      usable.cachedAt,
    );
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
    const record = { cachedAt: now.toISOString(), snapshot };
    await persistGoogleDetails(dependencies, place.id, googlePlaceId, record);
    await writeDetailsCache(detailsCache, googlePlaceId, record);
    return finishRestaurantPage(place, snapshot, "refreshed", record.cachedAt);
  }

  return finishRestaurantPage(
    place,
    usable.snapshot,
    usable.snapshot ? "stale-fallback" : "unavailable",
    usable.cachedAt,
  );
}
