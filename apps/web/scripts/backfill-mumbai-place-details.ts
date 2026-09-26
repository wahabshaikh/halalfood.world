import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  getGooglePlacesApiKey,
  googlePlaceMapsUrl,
} from "../src/lib/google-places";
import { queryD1 } from "./d1-rest-client";

export const CITY_SLUG = "mumbai";
const GOOGLE_DELAY_MS = 250;
const MUMBAI_SQL_PREDICATE = "city_slug = 'mumbai'";

export function assertMumbaiCitySlug(citySlug: string): asserts citySlug is "mumbai" {
  if (citySlug !== "mumbai") {
    throw new Error("This backfill is restricted to city_slug = 'mumbai'");
  }
}

assertMumbaiCitySlug(CITY_SLUG);

/** Guard every D1 SELECT/UPDATE so a future edit cannot widen this backfill. */
export function assertMumbaiScopedSql(sql: string): void {
  if (/\b(?:SELECT|UPDATE)\b/i.test(sql) && !sql.includes(MUMBAI_SQL_PREDICATE)) {
    throw new Error("Mumbai backfill SQL must include city_slug = 'mumbai'");
  }
}

export function shouldSkipPayload(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

type LegacyRecord = Record<string, unknown>;

function record(value: unknown): LegacyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LegacyRecord)
    : null;
}

function usableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type LegacyCoordinates = { lat: number; lng: number };

function legacyCoordinates(result: LegacyRecord): LegacyCoordinates | null {
  const geometry = record(result.geometry);
  const location = record(geometry?.location);
  const lat = location?.lat;
  const lng = location?.lng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

export type CompactGoogleDetailsSnapshot = {
  displayName: string | null;
  formattedAddress: string | null;
  coordinates: LegacyCoordinates | null;
};

/** Convert the legacy result to the compact shape consumed by restaurant-page.ts. */
export function compactSnapshotFromLegacyResult(
  value: unknown,
): CompactGoogleDetailsSnapshot {
  const result = record(value);
  return {
    displayName: usableString(result?.name),
    formattedAddress: usableString(result?.formatted_address),
    coordinates: result ? legacyCoordinates(result) : null,
  };
}

export type LegacyPlaceDetailsUpdate = {
  lat: number | null;
  lng: number | null;
  telephone: string | null;
  website: string | null;
  mapsUrl: string;
  ratingValue: string | null;
  reviewCount: number | null;
  googlePlacePayload: string;
  googlePlaceFetchedAt: number;
  googleDetailsSnapshot: string;
  googleDetailsCachedAt: number;
};

/** Map one successful legacy `result` object without changing listing identity fields. */
export function mapLegacyPlaceDetails(
  value: unknown,
  placeId: string,
  fetchedAt: number,
): LegacyPlaceDetailsUpdate | null {
  const result = record(value);
  if (!result) return null;

  const coordinates = legacyCoordinates(result);
  const snapshot = compactSnapshotFromLegacyResult(result);
  const payload = JSON.stringify(result);
  if (payload === undefined) return null;

  const rating = result.rating;
  const userRatingsTotal = result.user_ratings_total;
  return {
    lat: coordinates?.lat ?? null,
    lng: coordinates?.lng ?? null,
    telephone:
      usableString(result.international_phone_number) ??
      usableString(result.formatted_phone_number),
    website: usableString(result.website),
    mapsUrl: usableString(result.url) ?? googlePlaceMapsUrl(placeId),
    ratingValue:
      typeof rating === "number" && Number.isFinite(rating) ? String(rating) : null,
    reviewCount: Number.isSafeInteger(userRatingsTotal)
      ? (userRatingsTotal as number)
      : null,
    googlePlacePayload: payload,
    googlePlaceFetchedAt: fetchedAt,
    googleDetailsSnapshot: JSON.stringify(snapshot),
    googleDetailsCachedAt: fetchedAt,
  };
}

/**
 * The Places API (New) is blocked on this key with API_KEY_SERVICE_BLOCKED, so
 * this backfill intentionally uses legacy Place Details rather than the New client.
 * Omitting `fields` requests the full legacy result object for provenance.
 */
export function buildLegacyPlaceDetailsUrl(placeId: string, apiKey: string): string {
  const params = new URLSearchParams({
    place_id: placeId.trim(),
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
}

type LegacyFetchResult =
  | { ok: true; status: "OK"; result: LegacyRecord }
  | { ok: false; code: string };

async function fetchLegacyPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<LegacyFetchResult> {
  let response: Response;
  try {
    response = await fetch(buildLegacyPlaceDetailsUrl(placeId, apiKey), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }

  if (!response.ok) return { ok: false, code: `HTTP_${response.status}` };

  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch {
    return { ok: false, code: "INVALID_RESPONSE" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, code: "INVALID_RESPONSE" };
  }

  const body = record(payload);
  const status = typeof body?.status === "string" ? body.status : null;
  if (status !== "OK") return { ok: false, code: status ?? "INVALID_RESPONSE" };

  const result = record(body?.result);
  if (!result) return { ok: false, code: "INVALID_RESPONSE" };
  return { ok: true, status: "OK", result };
}

function safeLogCode(value: string): string {
  return /^[A-Z][A-Z0-9_:-]{0,63}$/.test(value) ? value : "UNSAFE_ERROR_CODE";
}

export function formatBackfillLogLine(placeId: string, statusOrErrorCode: string): string {
  const safePlaceId = /^[A-Za-z0-9_-]{1,256}$/.test(placeId)
    ? placeId
    : "UNSAFE_PLACE_ID";
  return `place_id=${safePlaceId} status=${safeLogCode(statusOrErrorCode)}`;
}

export type MumbaiPlaceRow = {
  id: string;
  google_place_id: string;
  google_place_payload: string | null;
};

export const LIST_MUMBAI_PLACES_SQL = `
SELECT id, google_place_id, google_place_payload
FROM places
WHERE city_slug = 'mumbai'
  AND google_place_id IS NOT NULL
  AND (google_place_payload IS NULL OR trim(google_place_payload) = '')
ORDER BY id`;

/** COALESCE preserves an existing listing fact when the legacy payload lacks it. */
export const UPDATE_MUMBAI_PLACE_DETAILS_SQL = `
UPDATE places
SET lat = COALESCE(?, lat),
    lng = COALESCE(?, lng),
    telephone = COALESCE(?, telephone),
    website = COALESCE(?, website),
    maps_url = COALESCE(?, maps_url),
    rating_value = COALESCE(?, rating_value),
    review_count = COALESCE(?, review_count),
    google_place_payload = ?,
    google_place_fetched_at = ?,
    google_details_snapshot = ?,
    google_details_cached_at = ?
WHERE city_slug = 'mumbai'
  AND id = ?
  AND google_place_id = ?
  AND (google_place_payload IS NULL OR trim(google_place_payload) = '')
RETURNING id`;

export function buildPlaceDetailsUpdateSql(): string {
  return UPDATE_MUMBAI_PLACE_DETAILS_SQL;
}

function updateParameters(
  update: LegacyPlaceDetailsUpdate,
  row: MumbaiPlaceRow,
): unknown[] {
  return [
    update.lat,
    update.lng,
    update.telephone,
    update.website,
    update.mapsUrl,
    update.ratingValue,
    update.reviewCount,
    update.googlePlacePayload,
    update.googlePlaceFetchedAt,
    update.googleDetailsSnapshot,
    update.googleDetailsCachedAt,
    row.id,
    row.google_place_id,
  ];
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function listMumbaiPlaces(): Promise<MumbaiPlaceRow[]> {
  assertMumbaiScopedSql(LIST_MUMBAI_PLACES_SQL);
  return queryD1<MumbaiPlaceRow>(LIST_MUMBAI_PLACES_SQL);
}

export type BackfillSummary = {
  selected: number;
  skipped: number;
  requested: number;
  updated: number;
  failed: number;
};

export async function runBackfill(): Promise<BackfillSummary> {
  assertMumbaiCitySlug(CITY_SLUG);
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not configured");

  const rows = await listMumbaiPlaces();
  const skippedRows = rows.filter((row) => shouldSkipPayload(row.google_place_payload));
  const candidates = rows.filter(
    (row) =>
      !shouldSkipPayload(row.google_place_payload) &&
      typeof row.google_place_id === "string" &&
      row.google_place_id.trim().length > 0,
  );

  let failed = 0;
  let updated = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const row = candidates[index];
    const result = await fetchLegacyPlaceDetails(row.google_place_id, apiKey);
    if (!result.ok) {
      failed += 1;
      console.error(formatBackfillLogLine(row.google_place_id, result.code));
    } else {
      console.log(formatBackfillLogLine(row.google_place_id, result.status));
      const update = mapLegacyPlaceDetails(result.result, row.google_place_id, Date.now());
      if (!update) {
        failed += 1;
        console.error(formatBackfillLogLine(row.google_place_id, "INVALID_RESPONSE"));
      } else {
        assertMumbaiScopedSql(UPDATE_MUMBAI_PLACE_DETAILS_SQL);
        const updatedRows = await queryD1<{ id: string }>(
          UPDATE_MUMBAI_PLACE_DETAILS_SQL,
          updateParameters(update, row),
        );
        if (updatedRows.length > 0) updated += 1;
      }
    }

    if (index < candidates.length - 1) await sleep(GOOGLE_DELAY_MS);
  }

  const summary = {
    selected: rows.length,
    skipped: skippedRows.length,
    requested: candidates.length,
    updated,
    failed,
  };
  console.log(
    `mumbai place-details backfill selected=${summary.selected} skipped=${summary.skipped} ` +
      `requested=${summary.requested} updated=${summary.updated} failed=${summary.failed}`,
  );
  return summary;
}

async function main(args: string[]): Promise<void> {
  if (args.length > 0) {
    throw new Error("This backfill accepts no command-line arguments");
  }
  assertMumbaiCitySlug(CITY_SLUG);
  await runBackfill();
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Mumbai place-details backfill failed",
    );
    process.exitCode = 1;
  });
}
