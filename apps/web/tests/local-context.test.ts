import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundingBox,
  buildLocalContext,
  initialMapView,
  LOCAL_RADIUS_KM,
} from "../src/lib/local-context";
import {
  distanceKm,
  formatDistance,
  locationFromCf,
  locationFromHeaders,
  VISITOR_HEADERS,
  withVisitorHeaders,
} from "../src/lib/visitor-location";
import type { City } from "../src/lib/places";

const city = (slug: string, lat: number, lng: number, count = 10): City => ({
  city_slug: slug,
  place_count: count,
  address_country: null,
  center_lat: lat,
  center_lng: lng,
});

const MUMBAI = city("mumbai", 19.07, 72.87, 500);
const LONDON = city("london", 51.5, -0.12, 900);
const DELHI = city("delhi", 28.61, 77.2, 300);

test("Cloudflare's cf object becomes a visitor location", () => {
  assert.deepEqual(
    locationFromCf({
      latitude: "19.2183",
      longitude: "72.9781",
      city: "Thane",
      region: "Maharashtra",
      country: "in",
    }),
    { lat: 19.2183, lng: 72.9781, city: "Thane", region: "Maharashtra", country: "IN" },
  );
  assert.equal(locationFromCf(undefined), null);
  assert.equal(locationFromCf({ latitude: "abc", longitude: "1" }), null);
  assert.equal(locationFromCf({ latitude: "0", longitude: "0" }), null);
  assert.equal(locationFromCf({ latitude: "91", longitude: "0" }), null);
});

test("the proxy replaces client-supplied location headers with the cf data", () => {
  const request = new Request("https://halalfood.world/", {
    headers: { [VISITOR_HEADERS.lat]: "1", [VISITOR_HEADERS.lng]: "2" },
  });
  const stripped = withVisitorHeaders(request);
  assert.equal(stripped.get(VISITOR_HEADERS.lat), null);

  Object.defineProperty(request, "cf", {
    value: { latitude: "48.85", longitude: "2.35", city: "Île-de-France", country: "FR" },
  });
  const headers = withVisitorHeaders(request);
  assert.equal(headers.get(VISITOR_HEADERS.lat), "48.85");
  assert.deepEqual(locationFromHeaders(headers)?.city, "Île-de-France");
});

test("Cloudflare's managed location headers are the fallback", () => {
  const headers = new Headers({
    "cf-iplatitude": "51.5",
    "cf-iplongitude": "-0.12",
    "cf-ipcity": "London",
    "cf-ipcountry": "GB",
  });
  assert.equal(locationFromHeaders(headers)?.city, "London");
  assert.equal(locationFromHeaders(new Headers()), null);
});

test("distances are great-circle and formatted for people", () => {
  const km = distanceKm({ lat: 51.5, lng: -0.12 }, { lat: 48.85, lng: 2.35 });
  assert.ok(km > 330 && km < 350, String(km));
  assert.equal(formatDistance(0.01), "50 m");
  assert.equal(formatDistance(0.34), "350 m");
  assert.equal(formatDistance(2.44), "2.4 km");
  assert.equal(formatDistance(1240.2), "1,240 km");
});

test("cities rank nearest first and local means within the radius", () => {
  const thane = { lat: 19.2183, lng: 72.9781, city: "Thane", region: null, country: "IN" };
  const context = buildLocalContext([LONDON, DELHI, MUMBAI], thane);
  assert.deepEqual(
    context.cities.map((c) => c.city_slug),
    ["mumbai", "delhi", "london"],
  );
  assert.equal(context.isLocal, true);
  assert.equal(context.areaName, "Thane");
  assert.deepEqual(initialMapView(context), { center: [72.9781, 19.2183], zoom: 12 });
});

test("far from every city, the map opens on the nearest one instead", () => {
  const tokyo = { lat: 35.68, lng: 139.69, city: "Tokyo", region: null, country: "JP" };
  const context = buildLocalContext([LONDON, MUMBAI], tokyo);
  assert.equal(context.isLocal, false);
  assert.equal(context.nearest?.city_slug, "mumbai");
  assert.ok((context.nearest?.distance_km ?? 0) > LOCAL_RADIUS_KM);
  assert.deepEqual(initialMapView(context), { center: [72.87, 19.07], zoom: 11 });
});

test("without a location, cities keep their size order and nothing is local", () => {
  const context = buildLocalContext([LONDON, MUMBAI], null);
  assert.deepEqual(context.cities.map((c) => c.city_slug), ["london", "mumbai"]);
  assert.equal(context.isLocal, false);
  assert.equal(context.areaName, null);
  assert.equal(initialMapView(context), null);
});

test("the search box around a point wraps the antimeridian", () => {
  const box = boundingBox({ lat: 0, lng: 179.9 }, 60);
  assert.ok(box.west > box.east, JSON.stringify(box));
  const plain = boundingBox({ lat: 19, lng: 72 }, 60);
  assert.ok(plain.south < 19 && plain.north > 19 && plain.west < 72 && plain.east > 72);
});
