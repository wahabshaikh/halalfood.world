import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPONSORED_DISCLOSURE,
  attachSponsored,
  buildHandoff,
  hasCommercialSignal,
  stripCommercialSignals,
  type SponsoredPlacement,
} from "../src/lib/commercial";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const DAY = 86_400_000;

function placement(overrides: Partial<SponsoredPlacement> = {}): SponsoredPlacement {
  return {
    id: "p1",
    placeId: "place-sponsored",
    label: "Sponsored by Al Noor Grill",
    startsAt: NOW - DAY,
    endsAt: NOW + DAY,
    ...overrides,
  };
}

test("sponsorship never enters the organic order", () => {
  const organic = ["a", "b", "c"];
  const result = attachSponsored(organic, [placement()], NOW);
  assert.deepEqual(
    result.organic.map((slot) => slot.placeId),
    organic,
  );
  assert.equal(result.organic.every((slot) => slot.kind === "organic"), true);
  assert.equal(result.sponsored.length, 1);
  assert.equal(result.sponsored[0].placeId, "place-sponsored");
});

test("every sponsored slot carries a disclosure", () => {
  const result = attachSponsored([], [placement()], NOW);
  assert.equal(result.sponsored[0].kind, "sponsored");
  assert.equal(
    result.sponsored[0].kind === "sponsored" && result.sponsored[0].disclosure,
    SPONSORED_DISCLOSURE,
  );
  assert.match(SPONSORED_DISCLOSURE, /does not affect halal status/);
});

test("a placement outside its window is not served", () => {
  assert.equal(
    attachSponsored([], [placement({ startsAt: NOW + DAY, endsAt: NOW + 2 * DAY })], NOW)
      .sponsored.length,
    0,
  );
  assert.equal(
    attachSponsored([], [placement({ startsAt: NOW - 2 * DAY, endsAt: NOW - DAY })], NOW)
      .sponsored.length,
    0,
  );
});

test("commercial fields are stripped before ranking can read them", () => {
  const input = {
    evidenceCount: 3,
    verifiedCheckIns: 8,
    distanceKm: 1.2,
    sponsored: true,
    paidTier: "gold",
    commissionRate: 0.1,
    isProSubscriber: true,
    bidAmount: 500,
  };
  const clean = stripCommercialSignals(input);
  assert.deepEqual(Object.keys(clean).sort(), [
    "distanceKm",
    "evidenceCount",
    "verifiedCheckIns",
  ]);
  assert.equal(hasCommercialSignal(input), true);
  assert.equal(hasCommercialSignal(clean), false);
});

test("a purely evidential ranking input passes through untouched", () => {
  const input = { evidenceCount: 2, wouldReturnPercent: 80, distanceKm: 0.4 };
  assert.deepEqual(stripCommercialSignals(input), input);
});

test("a handoff names its provider and discloses a commission", () => {
  const order = buildHandoff("order", "https://swiggy.com/r/123", null);
  assert.equal(order?.provider, "swiggy.com");
  assert.match(order?.disclosure ?? "", /may earn a commission/);

  const directions = buildHandoff("directions", "https://maps.example/x", "Maps");
  assert.equal(directions?.provider, "Maps");
  // Directions earn nothing, so nothing is disclosed.
  assert.equal(directions?.disclosure, null);
});

test("an unsafe or missing handoff target yields no link", () => {
  assert.equal(buildHandoff("order", null, null), null);
  assert.equal(buildHandoff("order", "javascript:alert(1)", null), null);
  assert.equal(buildHandoff("call", "tel:+912212345678", "Phone")?.action, "call");
});
