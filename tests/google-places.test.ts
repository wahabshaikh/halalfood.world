import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_PLACES_COORDINATE_FIELD_MASK,
  GOOGLE_PLACES_ADD_FIELD_MASK,
  GOOGLE_PLACES_FIELD_MASK,
  GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK,
  GOOGLE_PLACES_USEFUL_FIELD_MASK,
  googlePlaceLocality,
  enrichPlaceCoordinates,
  getGooglePlaceDetails,
  getGooglePlacesApiKey,
  googlePlaceDetailsUrl,
  googlePlaceMapsUrl,
  googlePlacesTextSearchUrl,
  searchGooglePlaces,
} from "../src/lib/google-places";

const originalFetch = globalThis.fetch;
const environmentKeys = ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY"] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);

function setEnvironment(
  values: Partial<Record<(typeof environmentKeys)[number], string | undefined>>,
) {
  for (const key of environmentKeys) {
    if (!(key in values)) continue;
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("missing Google Places key degrades without calling fetch", async () => {
  setEnvironment({ GOOGLE_PLACES_API_KEY: undefined, GOOGLE_MAPS_API_KEY: undefined });
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };

  const result = await getGooglePlaceDetails("ChIJexample");
  assert.deepEqual(result, {
    ok: false,
    code: "NOT_CONFIGURED",
    message: "Google Places is not configured",
  });
  assert.equal(called, false);
});

test("Places API details parse location into lat/lng and retain useful fields", async () => {
  setEnvironment({ GOOGLE_PLACES_API_KEY: "places-test-key", GOOGLE_MAPS_API_KEY: undefined });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "ChIJexample",
        name: "places/ChIJexample",
        displayName: { text: "Example Halal Kitchen", languageCode: "en" },
        formattedAddress: "1 Example Street",
        location: { latitude: 51.501, longitude: -0.141 },
        nationalPhoneNumber: "020 0000 0000",
        regularOpeningHours: { weekdayDescriptions: ["Monday: 9:00 AM–9:00 PM"] },
        photos: [{ name: "places/ChIJexample/photos/1" }],
      }),
    );

  const result = await getGooglePlaceDetails("ChIJexample");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.coordinates, { lat: 51.501, lng: -0.141 });
  assert.equal(result.place.displayName?.text, "Example Halal Kitchen");
  assert.equal(result.place.formattedAddress, "1 Example Street");
  assert.equal(result.place.photos?.[0]?.name, "places/ChIJexample/photos/1");
});

test("details request uses encoded place id, API key header, and explicit field mask", async () => {
  setEnvironment({ GOOGLE_PLACES_API_KEY: undefined, GOOGLE_MAPS_API_KEY: "maps-fallback-key" });
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ location: { latitude: 1, longitude: 2 } }));
  };

  await getGooglePlaceDetails("ChIJ/encoded id");
  assert.equal(
    requestedUrl,
    "https://places.googleapis.com/v1/places/ChIJ%2Fencoded%20id",
  );
  assert.equal(requestedHeaders?.get("x-goog-api-key"), "maps-fallback-key");
  assert.equal(requestedHeaders?.get("x-goog-fieldmask"), GOOGLE_PLACES_FIELD_MASK);
  assert.equal(googlePlaceDetailsUrl("ChIJ/encoded id"), requestedUrl);
  assert.ok(GOOGLE_PLACES_FIELD_MASK.includes("location"));
  assert.ok(GOOGLE_PLACES_FIELD_MASK.includes("formattedAddress"));
  assert.ok(GOOGLE_PLACES_USEFUL_FIELD_MASK.includes("regularOpeningHours"));
});

test("provider and malformed responses become safe structured errors", async () => {
  setEnvironment({ GOOGLE_PLACES_API_KEY: "do-not-leak-this-key" });
  globalThis.fetch = async () => new Response("quota exceeded", { status: 429 });

  const providerError = await getGooglePlaceDetails("ChIJexample");
  assert.deepEqual(providerError, {
    ok: false,
    code: "HTTP_ERROR",
    message: "Google Places rejected the request",
    status: 429,
  });
  assert.doesNotMatch(JSON.stringify(providerError), /do-not-leak-this-key/);

  globalThis.fetch = async () => new Response("not-json");
  const malformed = await getGooglePlaceDetails("ChIJexample");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, "INVALID_RESPONSE");
});

test("Places key takes precedence over the Maps fallback", () => {
  setEnvironment({
    GOOGLE_PLACES_API_KEY: "places-key",
    GOOGLE_MAPS_API_KEY: "maps-key",
  });
  assert.equal(getGooglePlacesApiKey(), "places-key");
});

test("coordinate enrichment prefers persisted values and uses the small mask only when needed", async () => {
  setEnvironment({ GOOGLE_PLACES_API_KEY: "places-test-key", GOOGLE_MAPS_API_KEY: undefined });
  let called = false;
  let fieldMask = "";
  globalThis.fetch = async (_input, init) => {
    called = true;
    fieldMask = new Headers(init?.headers).get("x-goog-fieldmask") ?? "";
    return new Response(JSON.stringify({ location: { latitude: 40.7, longitude: -74 } }));
  };

  const persisted = {
    google_place_id: "ChIJpersisted",
    lat: 10,
    lng: 20,
    name: "Persisted place",
  };
  assert.deepEqual(await enrichPlaceCoordinates(persisted), persisted);
  assert.equal(called, false);

  const enriched = await enrichPlaceCoordinates({
    google_place_id: "ChIJmissing",
    lat: null,
    lng: null,
    name: "Missing place",
  });
  assert.deepEqual(enriched, {
    google_place_id: "ChIJmissing",
    lat: 40.7,
    lng: -74,
    name: "Missing place",
  });
  assert.equal(fieldMask, GOOGLE_PLACES_COORDINATE_FIELD_MASK);
});

test("Google Text Search uses a small mask and returns selectable places", async () => {
  setEnvironment({ GOOGLE_PLACES_API_KEY: "places-test-key", GOOGLE_MAPS_API_KEY: undefined });
  let requestBody = "";
  let requestedHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body);
    requestedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        places: [
          {
            id: "ChIJexample",
            displayName: { text: "Example Halal Kitchen" },
            formattedAddress: "1 Example Street, London",
            location: { latitude: 51.5, longitude: -0.1 },
          },
          { id: "missing-address", displayName: { text: "Not complete" } },
        ],
      }),
    );
  };

  const result = await searchGooglePlaces("Example Kitchen");
  assert.deepEqual(result, {
    ok: true,
    places: [
      {
        id: "ChIJexample",
        displayName: "Example Halal Kitchen",
        formattedAddress: "1 Example Street, London",
        location: { latitude: 51.5, longitude: -0.1 },
      },
    ],
  });
  assert.deepEqual(JSON.parse(requestBody), {
    textQuery: "Example Kitchen",
  });
  assert.equal(requestedHeaders?.get("x-goog-api-key"), "places-test-key");
  assert.equal(
    requestedHeaders?.get("x-goog-fieldmask"),
    GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK,
  );
  assert.ok(GOOGLE_PLACES_ADD_FIELD_MASK.includes("displayName"));
  assert.equal(
    googlePlacesTextSearchUrl(),
    "https://places.googleapis.com/v1/places:searchText",
  );
  assert.match(googlePlaceMapsUrl("ChIJ/example"), /query_place_id=ChIJ%2Fexample/);
});

test("googlePlaceLocality prefers the locality, then the postal town", () => {
  assert.equal(
    googlePlaceLocality({
      addressComponents: [
        { longText: "E1 1JE", types: ["postal_code"] },
        { longText: "London", types: ["postal_town"] },
        { longText: "Greater London", types: ["administrative_area_level_2", "political"] },
      ],
    }),
    "London",
  );
  assert.equal(
    googlePlaceLocality({
      addressComponents: [
        { longText: "Mumbai", types: ["locality", "political"] },
        { longText: "Maharashtra", types: ["administrative_area_level_1"] },
      ],
    }),
    "Mumbai",
  );
  assert.equal(googlePlaceLocality({}), null);
  assert.equal(googlePlaceLocality({ addressComponents: [{ longText: "  ", types: ["locality"] }] }), null);
});
