import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { AMBIGUOUS_SPREAD_METERS, geocodeQuery, hasStreetAddress, judgeGeocode } from "./geocode-confidence";

const dishoom = { types: ["street_address"], formattedAddress: "7 Boundary St, London E2 7JE, UK", lat: 51.5245, lng: -0.0768 };
const LONDON = { city: "London", country: "United Kingdom" };

test("a single result in the right city and country is trusted", () => {
  assert.deepEqual(judgeGeocode([dishoom], LONDON), { ok: true, lat: dishoom.lat, lng: dishoom.lng });
  assert.equal(judgeGeocode([dishoom], { city: "london", country: "GB" }).ok, true);
  assert.equal(judgeGeocode([dishoom], { city: "London" }).ok, true);
  const dubai = { types: ["premise"], formattedAddress: "Sheikh Zayed Rd - Trade Centre - Dubai - United Arab Emirates", lat: 25.2, lng: 55.27 };
  assert.equal(judgeGeocode([dubai], { city: "Dubai", country: "UAE" }).ok, true);
  const berlin = { types: ["premise"], formattedAddress: "Sonnenallee 1, 12045 Berlin, Germany", lat: 52.49, lng: 13.43 };
  assert.equal(judgeGeocode([berlin], { city: "Berlin", country: "Germany" }).ok, true);
  const montreal = { types: ["premise"], formattedAddress: "1 Rue Saint-Denis, Montréal, QC H2X 3K8, Canada", lat: 45.51, lng: -73.56 };
  assert.equal(judgeGeocode([montreal], { city: "Montreal", country: "Canada" }).ok, true);
  // Nearby duplicates (the same building, a neighbour) are not ambiguity.
  assert.equal(judgeGeocode([dishoom, { ...dishoom, lat: dishoom.lat + 0.001 }], LONDON).ok, true);
});

test("no result, far-apart results, or the wrong city or country is low confidence", () => {
  assert.deepEqual(judgeGeocode([], LONDON), { ok: false, reason: "no_result" });
  assert.deepEqual(judgeGeocode([{ ...dishoom, lat: Number.NaN }], LONDON), { ok: false, reason: "no_result" });
  assert.deepEqual(judgeGeocode([{ ...dishoom, lat: 0, lng: 0 }], LONDON), { ok: false, reason: "no_result" });
  const farAway = { ...dishoom, lat: dishoom.lat + (AMBIGUOUS_SPREAD_METERS * 2) / 111_000 };
  assert.deepEqual(judgeGeocode([dishoom, farAway], LONDON), { ok: false, reason: "ambiguous" });
  const boundaryPortsmouth = { types: ["premise"], formattedAddress: "7 Boundary Rd, Portsmouth PO6 1AB, UK", lat: 50.84, lng: -1.07 };
  assert.deepEqual(judgeGeocode([boundaryPortsmouth], LONDON), { ok: false, reason: "wrong_city" });
  // "London" in Ontario is a different country.
  const ontario = { types: ["premise"], formattedAddress: "7 Boundary St, London, ON N6A 1A1, Canada", lat: 42.98, lng: -81.24 };
  assert.deepEqual(judgeGeocode([ontario], LONDON), { ok: false, reason: "wrong_country" });
  // A city word inside another word doesn't count.
  const londonderry = { types: ["premise"], formattedAddress: "7 Boundary St, Londonderry BT48, UK", lat: 55, lng: -7.3 };
  assert.deepEqual(judgeGeocode([londonderry], LONDON), { ok: false, reason: "wrong_city" });
});

test("geocodeQuery adds the city and country only when the address lacks them, within Google's length", () => {
  assert.equal(geocodeQuery({ address: "7 Boundary St", city: "London", country: "United Kingdom" }), "7 Boundary St, London, United Kingdom");
  assert.equal(geocodeQuery({ address: "7 Boundary St, London E2 7JE", city: "London", country: "United Kingdom" }), "7 Boundary St, London E2 7JE, United Kingdom");
  assert.equal(geocodeQuery({ address: "7 Boundary St, London, United Kingdom", city: "London", country: "United Kingdom" }), "7 Boundary St, London, United Kingdom");
  const long = geocodeQuery({ address: `${"Unit 4 ".repeat(30)}Market Hall`, city: "London", country: "United Kingdom" });
  assert.ok(long.length <= 120);
  assert.ok(!long.endsWith(","));
});

test("street addresses exclude city/country and postcode-only inputs", () => {
  for (const address of ["London", "London, United Kingdom", "London E2 7JE", "75001 Paris", "", "United Kingdom"]) {
    assert.equal(hasStreetAddress({ address, ...LONDON }), false, address);
  }
  for (const address of ["7 Boundary St", "Boundary Street, London", "Sonnenallee 1", "1 Rue Saint-Denis", "Sheikh Zayed Rd"]) {
    assert.equal(hasStreetAddress({ address, ...LONDON }), true, address);
  }
});

test("area types and missing precision are rejected even when the city matches", () => {
  for (const type of ["locality", "sublocality", "sublocality_level_1", "administrative_area_level_2", "postal_code", "postal_town", "country", "political", "colloquial_area", "neighborhood", "route"]) {
    assert.deepEqual(judgeGeocode([{ ...dishoom, types: [type] }], LONDON), { ok: false, reason: "not_street_level" }, type);
  }
  assert.deepEqual(judgeGeocode([{ ...dishoom, types: undefined }], LONDON), { ok: false, reason: "not_street_level" });
  for (const type of ["street_address", "premise", "establishment", "restaurant"]) {
    assert.equal(judgeGeocode([{ ...dishoom, types: [type] }], LONDON).ok, true, type);
  }
});

test("city/postcode inputs are not house numbers across postal formats", () => {
  for (const input of [
    { address: "Melbourne VIC 3000", city: "Melbourne", country: "Australia" },
    { address: "Melbourne Victoria 3000", city: "Melbourne", country: "Australia" },
    { address: "1010 Vienna", city: "Vienna", country: "Austria" },
    { address: "London 123", city: "London", country: "UK" },
    { address: "1012 AB Amsterdam", city: "Amsterdam", country: "Netherlands" },
  ]) assert.equal(hasStreetAddress(input), false, input.address);
});

test("city components accept normalized suffixes and local Tokyo names independently of proximity", () => {
  for (const [city, text, type] of [
    ["London", "Greater London", "administrative_area_level_2"],
    ["Tokyo", "東京都", "administrative_area_level_1"],
    ["Shibuya", "Shibuya City", "locality"],
    ["Shibuya-ku", "Shibuya", "sublocality_level_1"],
    ["Kyoto-shi", "Kyoto City", "postal_town"],
    ["Montreal", "Montréal Ward", "neighborhood"],
  ]) {
    const candidate = { ...dishoom, formattedAddress: "1 Example Road, UK", addressComponents: [{ longText: text, types: [type] }] };
    assert.equal(judgeGeocode([candidate], { city }).ok, true, `${city}: ${text}`);
  }
});

test("country components override address text, support ISO names, and fallback scans either end", () => {
  for (const [country, shortText, longText] of [["Canada", "CA", "Canada"], ["Japan", "JP", "日本"], ["JP", "JP", "日本"], ["Germany", "DE", "Deutschland"]]) {
    assert.equal(judgeGeocode([{ ...dishoom, addressComponents: [{ shortText, longText, types: ["country"] }] }], { city: "London", country }).ok, true);
  }
  assert.deepEqual(judgeGeocode([{ ...dishoom, addressComponents: [{ shortText: "CA", types: ["country"] }] }], LONDON), { ok: false, reason: "wrong_country" });
  for (const address of ["Japan, 1 Example Road, Tokyo", "日本、東京都、1 Example Road", "Japan - Tokyo - 1 Example Road", "Japan-Tokyo-1 Example Road"]) {
    assert.equal(judgeGeocode([{ ...dishoom, formattedAddress: address, lat: 35.68, lng: 139.76 }], { city: "Tokyo", country: "JP" }).ok, true, address);
  }
});


test("country aliases remain usable without Intl region names", () => {
  const displayNames = vi.spyOn(Intl, "DisplayNames").mockImplementation(() => { throw new Error("unavailable"); });
  try {
    assert.equal(judgeGeocode([{ ...dishoom, addressComponents: [{ shortText: "JP", types: ["country"] }] }], { city: "London", country: "Japan" }).ok, true);
    assert.deepEqual(judgeGeocode([{ ...dishoom, addressComponents: [{ types: ["country"] }] }], LONDON), { ok: false, reason: "wrong_country" });
  } finally { displayNames.mockRestore(); }
});
