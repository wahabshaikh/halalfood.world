const GOOGLE_PLACES_DETAILS_URL =
  "https://places.googleapis.com/v1/places";

/**
 * The default mask is intentionally explicit. Coordinate backfills use the
 * smaller location-only mask below so routine operational work stays
 * cost-conscious and does not request every Place field.
 */
export const GOOGLE_PLACES_FIELD_MASK = [
  "name",
  "displayName",
  "formattedAddress",
  "location",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "regularOpeningHours",
  "photos",
].join(",");

export const GOOGLE_PLACES_COORDINATE_FIELD_MASK = "location";

export type GooglePlaceLocation = {
  latitude: number;
  longitude: number;
};

export type GooglePlaceCoordinates = {
  lat: number;
  lng: number;
};

export type GooglePlaceDetails = {
  id?: string;
  /** Google resource name, for example `places/ChIJ...`. */
  name?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: GooglePlaceLocation;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  regularOpeningHours?: Record<string, unknown>;
  photos?: Record<string, unknown>[];
};

export type GooglePlacesErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_PLACE_ID"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export type GooglePlaceDetailsResult =
  | {
      ok: true;
      place: GooglePlaceDetails;
      coordinates: GooglePlaceCoordinates | null;
    }
  | {
      ok: false;
      code: GooglePlacesErrorCode;
      message: string;
      status?: number;
    };

/** Prefer the Places-specific secret, with the legacy Maps name as fallback. */
export function getGooglePlacesApiKey() {
  return (
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    null
  );
}

export function googlePlaceDetailsUrl(placeId: string) {
  return `${GOOGLE_PLACES_DETAILS_URL}/${encodeURIComponent(placeId.trim())}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseLocation(value: unknown): GooglePlaceLocation | undefined {
  const location = record(value);
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }
  return { latitude, longitude };
}

function parsePlace(value: unknown): GooglePlaceDetails | null {
  const payload = record(value);
  if (!payload) return null;

  const displayName = record(payload.displayName);
  const openingHours = record(payload.regularOpeningHours);
  const photos = Array.isArray(payload.photos)
    ? payload.photos.filter((photo): photo is Record<string, unknown> =>
        Boolean(record(photo)),
      )
    : undefined;
  const location = parseLocation(payload.location);

  return {
    ...(stringValue(payload.id) ? { id: payload.id as string } : {}),
    ...(stringValue(payload.name) ? { name: payload.name as string } : {}),
    ...(displayName
      ? {
          displayName: {
            ...(stringValue(displayName.text)
              ? { text: displayName.text as string }
              : {}),
            ...(stringValue(displayName.languageCode)
              ? { languageCode: displayName.languageCode as string }
              : {}),
          },
        }
      : {}),
    ...(stringValue(payload.formattedAddress)
      ? { formattedAddress: payload.formattedAddress as string }
      : {}),
    ...(location ? { location } : {}),
    ...(stringValue(payload.nationalPhoneNumber)
      ? { nationalPhoneNumber: payload.nationalPhoneNumber as string }
      : {}),
    ...(stringValue(payload.internationalPhoneNumber)
      ? { internationalPhoneNumber: payload.internationalPhoneNumber as string }
      : {}),
    ...(openingHours ? { regularOpeningHours: openingHours } : {}),
    ...(photos?.length ? { photos } : {}),
  };
}

/**
 * Fetch Place Details (New) with the platform fetch API. This is safe to call
 * from a page render: no key, bad provider response, or network failure is a
 * handled result and never a hard configuration exception.
 */
export async function getGooglePlaceDetails(
  placeId: string,
  options: { fieldMask?: string } = {},
): Promise<GooglePlaceDetailsResult> {
  const normalizedPlaceId = placeId.trim();
  if (!normalizedPlaceId) {
    return {
      ok: false,
      code: "INVALID_PLACE_ID",
      message: "A Google place id is required",
    };
  }

  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Google Places is not configured",
    };
  }

  const fieldMask = options.fieldMask?.trim() || GOOGLE_PLACES_FIELD_MASK;
  let response: Response;
  try {
    response = await fetch(googlePlaceDetailsUrl(normalizedPlaceId), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
    });
  } catch {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: "Unable to reach Google Places",
    };
  }

  let rawBody = "";
  try {
    rawBody = await response.text();
  } catch {
    return {
      ok: false,
      code: "HTTP_ERROR",
      message: "Google Places returned an unreadable response",
      status: response.status,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: "HTTP_ERROR",
      message: "Google Places rejected the request",
      status: response.status,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      message: "Google Places returned invalid JSON",
      status: response.status,
    };
  }

  const place = parsePlace(payload);
  if (!place) {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      message: "Google Places returned an invalid place",
      status: response.status,
    };
  }

  const coordinates = place.location
    ? { lat: place.location.latitude, lng: place.location.longitude }
    : null;
  return { ok: true, place, coordinates };
}

/** Get only coordinates for backfills or a page with missing DB coordinates. */
export async function getGooglePlaceCoordinates(
  placeId: string,
): Promise<GooglePlaceCoordinates | null> {
  const result = await getGooglePlaceDetails(placeId, {
    fieldMask: GOOGLE_PLACES_COORDINATE_FIELD_MASK,
  });
  return result.ok ? result.coordinates : null;
}

/**
 * Use persisted coordinates first. A missing key or failed lookup simply
 * leaves the place unchanged so SSR/SEO can still render its database data.
 */
export async function enrichPlaceCoordinates<
  T extends {
    google_place_id: string | null;
    lat: number | null;
    lng: number | null;
  },
>(place: T): Promise<T> {
  if (
    typeof place.lat === "number" &&
    Number.isFinite(place.lat) &&
    typeof place.lng === "number" &&
    Number.isFinite(place.lng)
  ) {
    return place;
  }
  if (!place.google_place_id) return place;

  const coordinates = await getGooglePlaceCoordinates(place.google_place_id);
  return coordinates
    ? { ...place, lat: coordinates.lat, lng: coordinates.lng }
    : place;
}
