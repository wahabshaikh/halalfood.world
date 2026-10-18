import { test } from "vitest";
import assert from "node:assert/strict";
import { AMBIGUOUS_SPREAD_METERS, geocodeQuery, judgeGeocode } from "./geocode-confidence";

const dishoom = { formattedAddress: "7 Boundary St, London E2 7JE, UK", lat: 51.5245, lng: -0.0768 };
const LONDON = { city: "London", country: "United Kingdom" };

test("a single result in the right city and country is trusted", () => {
  assert.deepEqual(judgeGeocode([dishoom], LONDON), { ok: true, lat: dishoom.lat, lng: dishoom.lng });
  assert.equal(judgeGeocode([dishoom], { city: "london", country: "GB" }).ok, true);
  assert.equal(judgeGeocode([dishoom], { city: "London" }).ok, true);
  const dubai = { formattedAddress: "Sheikh Zayed Rd - Trade Centre - Dubai - United Arab Emirates", lat: 25.2, lng: 55.27 };
  assert.equal(judgeGeocode([dubai], { city: "Dubai", country: "UAE" }).ok, true);
  const berlin = { formattedAddress: "Sonnenallee 1, 12045 Berlin, Germany", lat: 52.49, lng: 13.43 };
  assert.equal(judgeGeocode([berlin], { city: "Berlin", country: "Germany" }).ok, true);
  const montreal = { formattedAddress: "1 Rue Saint-Denis, Montréal, QC H2X 3K8, Canada", lat: 45.51, lng: -73.56 };
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
  const boundaryPortsmouth = { formattedAddress: "7 Boundary Rd, Portsmouth PO6 1AB, UK", lat: 50.84, lng: -1.07 };
  assert.deepEqual(judgeGeocode([boundaryPortsmouth], LONDON), { ok: false, reason: "wrong_city" });
  // "London" in Ontario is a different country.
  const ontario = { formattedAddress: "7 Boundary St, London, ON N6A 1A1, Canada", lat: 42.98, lng: -81.24 };
  assert.deepEqual(judgeGeocode([ontario], LONDON), { ok: false, reason: "wrong_country" });
  // A city word inside another word doesn't count.
  const londonderry = { formattedAddress: "7 Boundary St, Londonderry BT48, UK", lat: 55, lng: -7.3 };
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
