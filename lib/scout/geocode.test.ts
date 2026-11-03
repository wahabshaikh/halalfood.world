import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { createTestDatabase } from "@/lib/testing/sqlite-d1";
import type { ScoutDeps } from "./deps";
import { geocodePlace } from "./geocode";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const INPUT = { address: "7 Boundary St", city: "London", country: "United Kingdom" };

function setup(google: ScoutDeps["google"] = { apiKey: "test-key", searchCap: 5, detailsCap: 5 }) {
  const test = createTestDatabase();
  const deps: ScoutDeps = { db: test.db, origin: "https://halalfood.world", now: () => NOW, google };
  return { ...test, deps };
}

const place = (formattedAddress: string, latitude: number, longitude: number, id = "ChIJx") => ({ types: ["street_address"], id, displayName: { text: "x" }, formattedAddress, location: { latitude, longitude } });

function mockFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null, headers: init.headers as Record<string, string> });
    return respond(String(url), init);
  });
  return calls;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const spent = (sqlite: ReturnType<typeof setup>["sqlite"], key: string) =>
  Number((sqlite.prepare(`SELECT call_count AS n FROM google_search_daily WHERE day = ?`).get(key) as { n: number } | undefined)?.n ?? 0);

afterEach(() => vi.unstubAllGlobals());

test("Text Search on street, city and country; a confident answer is used and one unit is spent", async () => {
  const { deps, sqlite } = setup();
  const calls = mockFetch(() => json({ places: [place("7 Boundary St, London E2 7JE, UK", 51.5245, -0.0768)] }));
  assert.deepEqual(await geocodePlace(deps, INPUT), { ok: true, lat: 51.5245, lng: -0.0768, via: "text_search" });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /places:searchText$/);
  assert.deepEqual(calls[0]!.body, { textQuery: "7 Boundary St, London, United Kingdom" });
  assert.equal(calls[0]!.headers["X-Goog-Api-Key"], "test-key");
  assert.equal(spent(sqlite, "2026-10-18"), 1);
});

test("a Google place id uses Place Details for address and location, on the details budget", async () => {
  const { deps, sqlite } = setup();
  const calls = mockFetch(() => json({ types: ["street_address"], formattedAddress: "7 Boundary St, London E2 7JE, UK", location: { latitude: 51.5245, longitude: -0.0768 } }));
  assert.deepEqual(await geocodePlace(deps, { ...INPUT, googlePlaceId: "ChIJdishoom1" }), { ok: true, lat: 51.5245, lng: -0.0768, via: "google_place_id" });
  assert.match(calls[0]!.url, /places\/ChIJdishoom1$/);
  assert.equal(calls[0]!.headers["X-Goog-FieldMask"], "formattedAddress,location,types,addressComponents");
  assert.equal(spent(sqlite, "details:2026-10-18"), 1);
  assert.equal(spent(sqlite, "2026-10-18"), 0);
});

test("low confidence is no coordinates: nothing found, far-apart answers, the wrong city or country", async () => {
  const { deps } = setup({ apiKey: "test-key", searchCap: 50, detailsCap: 50 });
  const cases: [unknown, string][] = [
    [{ places: [] }, "no_result"],
    [{}, "provider_error"],
    [{ places: [place("7 Boundary St, London E2 7JE, UK", 51.52, -0.07), place("7 Boundary Rd, London NW8, UK", 51.54, -0.18, "b")] }, "ambiguous"],
    [{ places: [place("7 Boundary Rd, Portsmouth PO6 1AB, UK", 50.84, -1.07)] }, "wrong_city"],
    [{ places: [place("7 Boundary St, London, ON N6A 1A1, Canada", 42.98, -81.24)] }, "wrong_country"],
  ];
  for (const [body, reason] of cases) {
    mockFetch(() => json(body));
    assert.deepEqual(await geocodePlace(deps, INPUT), { ok: false, reason }, reason);
  }
});

test("a provider failure, an exhausted budget or a missing key never reaches a guess", async () => {
  const { deps, sqlite } = setup({ apiKey: "test-key", searchCap: 1, detailsCap: 0 });
  mockFetch(() => json({ error: { message: "quota" } }, 429));
  assert.deepEqual(await geocodePlace(deps, INPUT), { ok: false, reason: "provider_error" });
  const thrown = mockFetch(() => Promise.reject(new Error("offline")));
  // The day's single unit went on the 429: the next call doesn't reach Google.
  assert.deepEqual(await geocodePlace(deps, INPUT), { ok: false, reason: "budget_exhausted" });
  assert.equal(thrown.length, 0);
  assert.deepEqual(await geocodePlace(deps, { ...INPUT, googlePlaceId: "ChIJdishoom1" }), { ok: false, reason: "budget_exhausted" });
  assert.equal(spent(sqlite, "2026-10-18"), 1);

  const offline = setup();
  mockFetch(() => Promise.reject(new Error("offline")));
  assert.deepEqual(await geocodePlace(offline.deps, INPUT), { ok: false, reason: "provider_error" });

  for (const google of [undefined, { apiKey: null, searchCap: 5, detailsCap: 5 }, { apiKey: "", searchCap: 5, detailsCap: 5 }]) {
    const none = setup(google);
    // A default parameter would fill `undefined` in: take it off again.
    if (!google) delete none.deps.google;
    const calls = mockFetch(() => json({ places: [] }));
    assert.deepEqual(await geocodePlace(none.deps, INPUT), { ok: false, reason: "not_configured" });
    assert.equal(calls.length, 0);
    assert.equal(spent(none.sqlite, "2026-10-18"), 0);
  }
});

test("city-only input spends no budget and does not call Google, even with a place id", async () => {
  const { deps, sqlite } = setup();
  const calls = mockFetch(() => { throw new Error("must not fetch"); });
  for (const googlePlaceId of [undefined, "ChIJdishoom1"]) {
    assert.deepEqual(await geocodePlace(deps, { ...INPUT, address: "London, UK", googlePlaceId }), { ok: false, reason: "no_street_address" });
  }
  assert.equal(calls.length, 0);
  assert.equal(spent(sqlite, "2026-10-18"), 0);
});

test("both Google APIs reject area results and accept street-level types", async () => {
  const { deps } = setup({ apiKey: "test-key", searchCap: 30, detailsCap: 30 });
  for (const type of ["locality", "administrative_area_level_1", "postal_code", "street_address", "premise", "establishment"]) {
    for (const googlePlaceId of [undefined, "ChIJdishoom1"]) {
      const result = { ...place("7 Boundary St, London E2 7JE, UK", 51.52, -0.07), types: [type] };
      const calls = mockFetch(() => json(googlePlaceId ? result : { places: [result] }));
      const out = await geocodePlace(deps, { ...INPUT, googlePlaceId });
      assert.equal(out.ok, ["street_address", "premise", "establishment"].includes(type), type);
      if (!out.ok) assert.equal(out.reason, "not_street_level");
      assert.match(calls[0]!.headers["X-Goog-FieldMask"]!, /types/);
    }
  }
});


const component = (longText: string, shortText: string, type: string) => ({ longText, shortText, types: [type] });
const HOUSTON = {
  ...place("11201 Southwest Fwy, Houston, TX 77031, USA", 29.657, -95.565),
  types: ["restaurant", "food", "point_of_interest", "establishment"],
  addressComponents: [component("11201", "11201", "street_number"), component("Southwest Freeway", "Southwest Fwy", "route"), component("Houston", "Houston", "locality"), component("Harris County", "Harris County", "administrative_area_level_2"), component("Texas", "TX", "administrative_area_level_1"), component("United States", "US", "country"), component("77031", "77031", "postal_code")],
};

test("realistic Houston restaurant responses pass both Google APIs; route-only results still fail", async () => {
  const { deps } = setup();
  for (const googlePlaceId of [undefined, "ChIJhouston"]) {
    const calls = mockFetch(() => json(googlePlaceId ? HOUSTON : { places: [HOUSTON] }));
    assert.deepEqual(await geocodePlace(deps, { address: "11201 Southwest Fwy, Houston", city: "Houston", country: "USA", googlePlaceId }), { ok: true, lat: 29.657, lng: -95.565, via: googlePlaceId ? "google_place_id" : "text_search" });
    assert.equal(calls.length, 1);
    const route = { ...HOUSTON, types: ["route"] };
    mockFetch(() => json(googlePlaceId ? route : { places: [route] }));
    assert.deepEqual(await geocodePlace(deps, { address: "Southwest Fwy, Houston", city: "Houston", country: "USA", googlePlaceId }), { ok: false, reason: "not_street_level" });
  }
});

test("Grill Hunter Shimbashi succeeds with English and Japanese Google addresses and district cities", async () => {
  const { deps } = setup({ apiKey: "test-key", searchCap: 30, detailsCap: 30 });
  for (const japanese of [false, true]) {
    const result = {
      ...place(japanese ? "日本、〒105-0004 東京都港区新橋２丁目１５−３" : "2-chōme-15-3 Shinbashi, Minato City, Tokyo 105-0004, Japan", 35.666, 139.756),
      types: ["restaurant", "food", "point_of_interest", "establishment"],
      displayName: { text: "Grill Hunter Shimbashi" },
      addressComponents: [component("Grill Hunter", "Grill Hunter", "premise"), component("2", "2", "sublocality_level_4"), component("15", "15", "sublocality_level_3"), component(japanese ? "新橋" : "Shinbashi", japanese ? "新橋" : "Shinbashi", "sublocality_level_2"), component(japanese ? "港区" : "Minato City", japanese ? "港区" : "Minato", "locality"), component(japanese ? "東京都" : "Tokyo", japanese ? "東京都" : "Tokyo", "administrative_area_level_1"), component(japanese ? "日本" : "Japan", "JP", "country")],
    };
    for (const city of ["Tokyo", "Minato", "Shimbashi"]) {
      for (const googlePlaceId of [undefined, "ChIJhunter"]) {
        const calls = mockFetch(() => json(googlePlaceId ? result : { places: [result] }));
        const out = await geocodePlace(deps, { address: japanese ? "東京都港区新橋２丁目１５−３" : "2-chome 15-3 Shinbashi", city, country: "Japan", googlePlaceId });
        assert.deepEqual(out, { ok: true, lat: 35.666, lng: 139.756, via: googlePlaceId ? "google_place_id" : "text_search" }, `${city}, Japanese: ${japanese}`);
        assert.equal(calls.length, 1);
      }
    }
  }
});
