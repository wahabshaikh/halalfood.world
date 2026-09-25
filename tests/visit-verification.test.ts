import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCATION_PROOF_RADIUS_M,
  MANUAL_VISIT,
  distanceMeters,
  isVerifiedVisit,
  verifyByLocation,
  verifyByReceipt,
  withinDiningHours,
} from "../src/lib/visit-verification";

const PLACE = { lat: 19.0596, lng: 72.8295 };
const VISITED_AT = Date.parse("2026-09-17T14:00:00.000Z");

test("distance is a real great-circle distance", () => {
  assert.equal(Math.round(distanceMeters(PLACE, PLACE)), 0);
  const nearby = distanceMeters(PLACE, { lat: 19.0601, lng: 72.8295 });
  assert.ok(nearby > 40 && nearby < 70, `expected ~55m, got ${nearby}`);
});

test("presence at the venue during dining hours verifies the visit", () => {
  const result = verifyByLocation({
    device: { lat: 19.0597, lng: 72.8296, accuracyMeters: 20 },
    place: PLACE,
    visitedAt: VISITED_AT,
    now: VISITED_AT,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.result.method, "location");
  assert.equal(result.result.confidence, "high");
  // The detail must not leak the coordinates it was derived from.
  assert.ok(!/\d+\.\d{3}/.test(result.result.detail));
});

test("a distant, stale or inaccurate fix downgrades to a manual visit", () => {
  const tooFar = verifyByLocation({
    device: { lat: 19.2, lng: 72.9, accuracyMeters: 10 },
    place: PLACE,
    visitedAt: VISITED_AT,
    now: VISITED_AT,
  });
  assert.deepEqual(tooFar, { ok: false, reason: "too-far" });

  const late = verifyByLocation({
    device: { lat: 19.0597, lng: 72.8296, accuracyMeters: 10 },
    place: PLACE,
    visitedAt: VISITED_AT,
    now: VISITED_AT + 5 * 60 * 60 * 1000,
  });
  assert.deepEqual(late, { ok: false, reason: "outside-window" });

  const vague = verifyByLocation({
    device: {
      lat: 19.0597,
      lng: 72.8296,
      accuracyMeters: LOCATION_PROOF_RADIUS_M + 1,
    },
    place: PLACE,
    visitedAt: VISITED_AT,
    now: VISITED_AT,
  });
  assert.deepEqual(vague, { ok: false, reason: "inaccurate-fix" });
});

test("a place with no coordinates cannot be location-verified", () => {
  assert.deepEqual(
    verifyByLocation({
      device: { lat: 19.0597, lng: 72.8296 },
      place: { lat: null, lng: null },
      visitedAt: VISITED_AT,
      now: VISITED_AT,
    }),
    { ok: false, reason: "place-has-no-coordinates" },
  );
});

test("dining hours run past midnight", () => {
  const nineAm = Date.parse("2026-09-17T09:00:00.000Z");
  const oneAm = Date.parse("2026-09-17T01:00:00.000Z");
  const fourAm = Date.parse("2026-09-17T04:00:00.000Z");
  assert.equal(withinDiningHours(nineAm, 0), true);
  assert.equal(withinDiningHours(oneAm, 0), true);
  assert.equal(withinDiningHours(fourAm, 0), false);
});

test("receipt confidence rises with what the diner confirms", () => {
  const bare = verifyByReceipt({ contentType: "image/jpeg", byteSize: 1024 });
  assert.equal(bare.ok, true);
  if (bare.ok) assert.equal(bare.result.confidence, "low");

  const full = verifyByReceipt({
    contentType: "application/pdf",
    byteSize: 2048,
    declared: { venueNameMatches: true, visitDateMatches: true },
  });
  assert.equal(full.ok, true);
  if (full.ok) {
    assert.equal(full.result.confidence, "high");
    assert.match(full.result.detail, /kept private/);
  }
});

test("receipts outside the allowed types or size are refused", () => {
  assert.equal(verifyByReceipt({ contentType: "text/html", byteSize: 10 }).ok, false);
  assert.equal(
    verifyByReceipt({ contentType: "image/png", byteSize: 9 * 1024 * 1024 }).ok,
    false,
  );
});

test("a manual visit is recorded but never counts as verified", () => {
  assert.equal(isVerifiedVisit(MANUAL_VISIT), false);
  assert.equal(isVerifiedVisit({ method: "receipt", confidence: "low" }), true);
});
