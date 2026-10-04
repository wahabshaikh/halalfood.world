import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_PLACES_FIELD_MASK,
  type GooglePlaceDetailsResult,
} from "../src/lib/google-places";
import type { PlaceDetail } from "../src/lib/places";
import {
  COMMUNITY_LAYERS,
  GOOGLE_DETAILS_CACHE_TTL_SECONDS,
  assembleRestaurantPage,
  buildRestaurantPageModel,
  layeredGoogleDetailsCache,
  memoryGoogleDetailsCache,
  type GoogleDetailsCacheWrite,
  type GoogleDetailsSnapshot,
} from "../src/lib/restaurant-page";
import { placeDescription, placeJsonLd } from "../src/lib/seo";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const GOOGLE_ID = "ChIJrestaurant";
const NOW = new Date("2026-09-14T12:00:00.000Z");

function place(overrides: Partial<PlaceDetail> = {}): PlaceDetail {
  return {
    id: PLACE_ID,
    name: "Saved Halal Kitchen",
    city_slug: "london",
    street_address: "1 Example Street",
    address_locality: "London",
    address_region: "England",
    postal_code: "E1 1AA",
    address_country: "United Kingdom",
    telephone: "+44 20 0000 0000",
    website: "https://example.com",
    rating_value: "4.50",
    review_count: 42,
    lat: 51.5,
    lng: -0.1,
    maps_url: null,
    google_place_id: GOOGLE_ID,
    serves_cuisine: ["Indian"],
    source: "directory",
    source_url: "https://directory.example/place",
    scraped_at: NOW,
    halal_confirmed: true,
    google_details_cached_at: null,
    google_details_snapshot: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GoogleDetailsSnapshot> = {}): GoogleDetailsSnapshot {
  return {
    displayName: "Cached Halal Kitchen",
    formattedAddress: "Cached Google address",
    coordinates: { lat: 51.501, lng: -0.101 },
    ...overrides,
  };
}

function successfulGoogleResult(): GooglePlaceDetailsResult {
  return {
    ok: true,
    place: {
      id: GOOGLE_ID,
      displayName: { text: "Live Halal Kitchen" },
      formattedAddress: "Live Google address",
      location: { latitude: 51.502, longitude: -0.102 },
    },
    coordinates: { lat: 51.502, lng: -0.102 },
  };
}

test("fresh Google cache wins without a live fetch", async () => {
  let fetchCalled = false;
  let saveCalled = false;
  const model = await assembleRestaurantPage(
    place({
      google_details_cached_at: new Date(NOW.valueOf() - 2 * 60 * 60 * 1000),
      google_details_snapshot: JSON.stringify(snapshot()),
    }),
    {
      now: () => NOW,
      detailsCache: memoryGoogleDetailsCache(),
      fetchGoogleDetails: async () => {
        fetchCalled = true;
        return successfulGoogleResult();
      },
      saveGoogleDetails: async () => {
        saveCalled = true;
      },
    },
  );

  assert.equal(fetchCalled, false);
  assert.equal(saveCalled, false);
  assert.equal(model.google.cacheStatus, "cached");
  assert.equal(model.place.name, "Cached Halal Kitchen");
  assert.equal(model.google.formattedAddress, "Cached Google address");
  assert.deepEqual(model.place.lat, 51.5, "persisted coordinates remain authoritative");
});

test("stale Google cache triggers one Essentials fetch and writes the new snapshot", async () => {
  let requestedPlaceId = "";
  let requestedMask = "";
  let saved: GoogleDetailsCacheWrite | null = null;
  const model = await assembleRestaurantPage(
    place({
      lat: null,
      lng: null,
      google_details_cached_at: new Date(NOW.valueOf() - 8 * 24 * 60 * 60 * 1000),
      google_details_snapshot: JSON.stringify(snapshot()),
    }),
    {
      now: () => NOW,
      detailsCache: memoryGoogleDetailsCache(),
      reserveGoogleDetailsCall: async () => true,
      fetchGoogleDetails: async (placeId, options) => {
        requestedPlaceId = placeId;
        requestedMask = options?.fieldMask ?? "";
        return successfulGoogleResult();
      },
      saveGoogleDetails: async (input) => {
        saved = input;
      },
    },
  );

  assert.equal(requestedPlaceId, GOOGLE_ID);
  assert.equal(requestedMask, GOOGLE_PLACES_FIELD_MASK);
  assert.equal(model.google.cacheStatus, "refreshed");
  assert.equal(model.place.name, "Live Halal Kitchen");
  assert.equal(model.google.formattedAddress, "Live Google address");
  assert.deepEqual(model.place.lat, 51.502);
  assert.deepEqual((saved as unknown as GoogleDetailsCacheWrite).snapshot, {
    displayName: "Live Halal Kitchen",
    formattedAddress: "Live Google address",
    coordinates: { lat: 51.502, lng: -0.102 },
  });
});

test("a complete listing renders without calling Google", async () => {
  let calls = 0;
  const model = await assembleRestaurantPage(place(), {
    now: () => NOW,
    detailsCache: memoryGoogleDetailsCache(),
    reserveGoogleDetailsCall: async () => {
      throw new Error("a complete listing must not reserve a Place Details call");
    },
    fetchGoogleDetails: async () => {
      calls += 1;
      return successfulGoogleResult();
    },
  });

  assert.equal(calls, 0);
  assert.equal(model.google.cacheStatus, "unavailable");
  assert.equal(model.place.name, "Saved Halal Kitchen");
  assert.equal(model.google.displayNameSource, "listing");
  assert.equal(model.google.address, "1 Example Street, London, England, United Kingdom");
});

test("a warm Place Details cache makes no fetch", async () => {
  const stored = new Map<string, string>();
  const edge = {
    async match(request: Request) {
      const body = stored.get(request.url);
      return body ? new Response(body) : undefined;
    },
    async put(request: Request, response: Response) {
      stored.set(request.url, await response.text());
    },
  };
  const record = {
    cachedAt: new Date(NOW.valueOf() - 60 * 60 * 1000).toISOString(),
    snapshot: snapshot(),
  };
  await layeredGoogleDetailsCache(memoryGoogleDetailsCache(), async () => edge).set(
    GOOGLE_ID,
    record,
    GOOGLE_DETAILS_CACHE_TTL_SECONDS,
  );
  const cold = layeredGoogleDetailsCache(memoryGoogleDetailsCache(), async () => edge);
  let calls = 0;
  const model = await assembleRestaurantPage(
    place({ lat: null, lng: null, google_details_snapshot: null }),
    {
      now: () => NOW,
      detailsCache: cold,
      reserveGoogleDetailsCall: async () => {
        throw new Error("a cache hit must not reserve a Place Details call");
      },
      fetchGoogleDetails: async () => {
        calls += 1;
        return successfulGoogleResult();
      },
    },
  );

  assert.equal(calls, 0);
  assert.equal(model.google.cacheStatus, "cached");
  assert.equal(model.place.name, "Cached Halal Kitchen");
  assert.equal(model.google.formattedAddress, "Cached Google address");
  assert.equal(model.place.lat, 51.501);
});

test("a capped Place Details request makes no fetch and the page still renders", async () => {
  let calls = 0;
  const model = await assembleRestaurantPage(
    place({ lat: null, lng: null }),
    {
      now: () => NOW,
      detailsCache: memoryGoogleDetailsCache(),
      reserveGoogleDetailsCall: async () => false,
      fetchGoogleDetails: async () => {
        calls += 1;
        return successfulGoogleResult();
      },
    },
  );

  assert.equal(calls, 0);
  assert.equal(model.google.cacheStatus, "unavailable");
  assert.equal(model.place.name, "Saved Halal Kitchen");
  assert.equal(model.google.displayNameSource, "listing");
  assert.equal(model.google.formattedAddress, null);
  assert.match(model.google.address, /London/);

  const thrown = await assembleRestaurantPage(place({ lat: null, lng: null }), {
    now: () => NOW,
    detailsCache: memoryGoogleDetailsCache(),
    reserveGoogleDetailsCall: async () => {
      throw new Error("google_search_daily is missing");
    },
    fetchGoogleDetails: async () => {
      calls += 1;
      return successfulGoogleResult();
    },
  });
  assert.equal(calls, 0);
  assert.equal(thrown.place.name, "Saved Halal Kitchen");
  assert.equal(thrown.google.cacheStatus, "unavailable");
});

test("Google failure keeps the database row and stale snapshot usable", async () => {
  let saveCalled = false;
  let calls = 0;
  const model = await assembleRestaurantPage(
    place({
      google_details_cached_at: new Date(NOW.valueOf() - 8 * 24 * 60 * 60 * 1000),
      google_details_snapshot: JSON.stringify(snapshot()),
    }),
    {
      now: () => NOW,
      detailsCache: memoryGoogleDetailsCache(),
      fetchGoogleDetails: async () => {
        calls += 1;
        return {
          ok: false,
          code: "NOT_CONFIGURED",
          message: "Google Places is not configured",
        };
      },
      saveGoogleDetails: async () => {
        saveCalled = true;
      },
    },
  );

  assert.equal(calls, 0);
  assert.equal(saveCalled, false);
  assert.equal(model.google.cacheStatus, "stale-fallback");
  assert.equal(model.place.name, "Cached Halal Kitchen");
  assert.equal(model.google.telephone, "+44 20 0000 0000");

  const unavailable = await assembleRestaurantPage(place(), {
    now: () => NOW,
    detailsCache: memoryGoogleDetailsCache(),
    fetchGoogleDetails: async () => {
      calls += 1;
      return {
        ok: false,
        code: "NOT_CONFIGURED",
        message: "Google Places is not configured",
      };
    },
  });
  assert.equal(calls, 0);
  assert.equal(unavailable.google.cacheStatus, "unavailable");
  assert.equal(unavailable.place.name, "Saved Halal Kitchen");
});

test("Google content older than 30 days is not served", async () => {
  let calls = 0;
  const model = await assembleRestaurantPage(
    place({
      google_details_cached_at: new Date(NOW.valueOf() - 31 * 24 * 60 * 60 * 1000),
      google_details_snapshot: JSON.stringify(snapshot()),
    }),
    {
      now: () => NOW,
      detailsCache: memoryGoogleDetailsCache(),
      fetchGoogleDetails: async () => {
        calls += 1;
        return successfulGoogleResult();
      },
    },
  );

  assert.equal(calls, 0);
  assert.equal(model.google.cacheStatus, "unavailable");
  assert.equal(model.place.name, "Saved Halal Kitchen");
  assert.equal(model.google.formattedAddress, null);
});

test("the model keeps Google listing facts and community layers distinct", () => {
  const model = buildRestaurantPageModel(place(), {
    snapshot: snapshot(),
    cacheStatus: "cached",
    cachedAt: NOW,
  });

  assert.equal(model.google.linked, true);
  assert.equal(model.google.addressSource, "google");
  assert.equal(model.google.mapsSource, "google");
  assert.equal(model.google.mapsUrl, "https://www.google.com/maps/search/?api=1&query=Google&query_place_id=ChIJrestaurant");
  assert.deepEqual(model.community.layers, COMMUNITY_LAYERS);
  assert.equal(model.community.halalConfirmed, true);
  assert.match(model.community.note, /verification evidence/);
});

test("SEO exposes truthful community evidence without turning reactions into a rating", () => {
  const model = buildRestaurantPageModel(place(), {
    snapshot: snapshot(),
    cacheStatus: "cached",
  });
  const data = placeJsonLd(model.place, {
    mapsUrl: model.google.mapsUrl,
    communityNote: model.community.note,
    communityReviewCount: 3,
  }) as Record<string, any>;
  const properties = data.additionalProperty as Record<string, unknown>[];

  assert.equal(data.aggregateRating.ratingValue, 4.5);
  assert.equal(data.hasMap, model.google.mapsUrl);
  assert.equal(
    properties.find((property) => property.name === "communityReviewCount")?.value,
    3,
  );
  assert.match(
    String(properties.find((property) => property.name === "communityEvidenceNote")?.value),
    /halal reaction/,
  );
  assert.match(placeDescription(model.place, { includeCommunity: true }), /approximate/i);
});
