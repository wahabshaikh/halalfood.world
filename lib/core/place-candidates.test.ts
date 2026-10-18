import assert from "node:assert/strict";
import { test } from "vitest";
import {
  boundingBox,
  clampRadius,
  DEFAULT_RADIUS_METERS,
  distanceMeters,
  MAX_RADIUS_METERS,
  nameSearchTerms,
  nameSimilarity,
  rankCandidates,
  SAME_PLACE_SCORE,
  scoreCandidate,
  type CandidateRow,
} from "./place-candidates";

const LONDON = { lat: 51.5145, lng: -0.0719 };

function row(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: over.id ?? "p1",
    name: "Dishoom Shoreditch",
    citySlug: "london",
    streetAddress: "7 Boundary St, London E2 7JE",
    addressLocality: "London",
    lat: LONDON.lat,
    lng: LONDON.lng,
    googlePlaceId: null,
    ...over,
  };
}

const query = (over = {}) => ({ name: "Dishoom Shoreditch", city: "London", citySlug: "london", location: LONDON, radiusMeters: 300, ...over });

test("distance and bounding box", () => {
  assert.equal(distanceMeters(LONDON, LONDON), 0);
  const north = { lat: LONDON.lat + 0.001, lng: LONDON.lng };
  assert.ok(Math.abs(distanceMeters(LONDON, north) - 111) < 2);
  const box = boundingBox(LONDON, 300);
  assert.ok(box.minLat < LONDON.lat && box.maxLat > LONDON.lat && box.minLng < LONDON.lng && box.maxLng > LONDON.lng);
  assert.ok(boundingBox({ lat: 89.99, lng: 0 }, 2000).maxLng <= 180);
  assert.equal(clampRadius(undefined), DEFAULT_RADIUS_METERS);
  assert.equal(clampRadius(99_999), MAX_RADIUS_METERS);
  assert.equal(clampRadius(0), 1);
  assert.equal(clampRadius(Number.NaN), DEFAULT_RADIUS_METERS);
});

test("name similarity", () => {
  assert.equal(nameSimilarity("Dishoom", "dishoom"), 1);
  assert.equal(nameSimilarity("Dishoom Shoreditch", "Shoreditch Dishoom"), 0.95);
  assert.equal(nameSimilarity("Slam Burger", "Slamburger Halal Luton"), 0.9);
  assert.ok(nameSimilarity("Tayyabs Restaurant", "Tayyabs Grill House") >= 0.8);
  assert.equal(nameSimilarity("Burger King", "Pizza Hut"), 0);
  assert.equal(nameSimilarity("", "x"), 0);
  assert.equal(nameSimilarity("Halal Restaurant", "Halal Food"), 0);
});

test("search terms are distinctive words, or the whole name", () => {
  assert.deepEqual(nameSearchTerms("The Tayyabs Halal Restaurant"), ["tayyabs"]);
  assert.deepEqual(nameSearchTerms("Halal Restaurant"), ["halal restaurant"]);
  assert.deepEqual(nameSearchTerms("   "), []);
  assert.equal(nameSearchTerms("Alpha Bravo Charlie Delta Echo").length, 4);
});

test("same name at the same spot is the same place", () => {
  const ranked = scoreCandidate(query(), row())!;
  assert.equal(ranked.score, 1);
  assert.equal(ranked.distanceMeters, 0);
  assert.equal(ranked.matchedBy, "name_and_location");
});

test("distance lowers the score; beyond the radius only the address path is left", () => {
  const near = scoreCandidate(query(), row({ lat: LONDON.lat + 0.002 }))!; // ~222 m
  assert.ok(near.score < SAME_PLACE_SCORE && near.score > 0.75);
  const far = scoreCandidate(query({ city: null, citySlug: null }), row({ lat: LONDON.lat + 0.01 }));
  assert.equal(far, null);
});

test("a chain branch in the same city without a matching street is not the same place", () => {
  const other = scoreCandidate(query({ location: null }), row({ lat: null, lng: null }))!;
  assert.equal(other.matchedBy, "name_and_address");
  assert.ok(other.score < SAME_PLACE_SCORE);
  const sameStreet = scoreCandidate(query({ location: null, address: "7 Boundary St, Shoreditch" }), row({ lat: null, lng: null }))!;
  assert.equal(sameStreet.score, 1);
  // City from address_locality when slugs differ.
  assert.ok(scoreCandidate(query({ location: null, citySlug: "greater-london" }), row({ lat: null, lng: null })));
});

test("a Google place id match wins outright", () => {
  const ranked = scoreCandidate(query({ googlePlaceId: "g1", name: "Totally different" }), row({ googlePlaceId: "g1" }))!;
  assert.equal(ranked.score, 1);
  assert.equal(ranked.matchedBy, "google_place_id");
});

test("unrelated names never rank", () => {
  assert.equal(scoreCandidate(query(), row({ name: "Pizza Hut" })), null);
});

test("ranking orders by score, then distance, dedupes and limits", () => {
  const rows = [
    row({ id: "far", lat: LONDON.lat + 0.002 }),
    row({ id: "same" }),
    row({ id: "same" }),
    row({ id: "other", name: "Dishoom", lat: LONDON.lat + 0.0005 }),
    row({ id: "none", name: "Pizza Hut" }),
  ];
  const ranked = rankCandidates(query(), rows, 5);
  assert.deepEqual(ranked.map((r) => r.id), ["same", "other", "far"]);
  assert.equal(rankCandidates(query(), rows, 1).length, 1);
});

test("a stall named after its host venue never matches the venue, however close (Oklahoma Burgers regression)", () => {
  const hall = { id: "hall", name: "Kingsbridge Food Hall", citySlug: "london", streetAddress: "1 Kingsbridge Rd, London", addressLocality: "London", lat: 51.5, lng: -0.1, googlePlaceId: null };
  for (const name of ["Oklahoma Burgers - Kingsbridge Food Hall", "Oklahoma Burgers at Kingsbridge Food Hall", "Oklahoma Burgers"]) {
    const query = { name, city: "London", citySlug: "london", address: "1 Kingsbridge Rd, London", location: { lat: 51.5, lng: -0.1 }, radiusMeters: 300 };
    const ranked = rankCandidates(query, [hall]);
    assert.ok((ranked[0]?.score ?? 0) < SAME_PLACE_SCORE, `${name}: ${ranked[0]?.score}`);
  }
  // The stall's own row still matches its own name, and a branch suffix still counts.
  const stall = { ...hall, id: "stall", name: "Oklahoma Burgers at Kingsbridge Food Hall" };
  const query = { name: "Oklahoma Burgers", city: "London", citySlug: "london", address: "1 Kingsbridge Rd, London", location: { lat: 51.5, lng: -0.1 }, radiusMeters: 300 };
  assert.equal(rankCandidates(query, [hall, stall])[0]?.id, "stall");
  assert.ok(rankCandidates(query, [stall])[0]!.score >= SAME_PLACE_SCORE);
  assert.equal(nameSimilarity("Kingsbridge Food Hall", "Oklahoma Burgers Kingsbridge Food Hall") < 0.8, true);
});
