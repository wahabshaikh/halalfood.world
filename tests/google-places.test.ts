import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_PLACES_FIELD_MASK,
  getGooglePlaceDetails,
  getGooglePlacesApiKey,
  googlePlaceDetailsUrl,
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
