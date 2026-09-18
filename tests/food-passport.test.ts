import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFoodPassport,
  buildMilestones,
  type PassportVisit,
} from "../src/lib/food-passport";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const DAY = 86_400_000;

function visit(overrides: Partial<PassportVisit> = {}): PassportVisit {
  return {
    placeId: "place-1",
    citySlug: "mumbai",
    neighbourhood: "Bandra",
    country: "India",
    cuisines: ["Mughlai"],
    verified: true,
    visitedAt: NOW - DAY,
    ...overrides,
  };
}

test("verified and self-reported visits are counted separately", () => {
  const passport = buildFoodPassport([
    visit({ placeId: "a" }),
    visit({ placeId: "b", verified: false }),
  ]);
  assert.equal(passport.verifiedVisits, 1);
  assert.equal(passport.unverifiedVisits, 1);
  assert.equal(passport.distinctPlaces, 2);
});

test("coverage counts distinct places, not repeat visits", () => {
  const passport = buildFoodPassport([
    visit({ placeId: "a", neighbourhood: "Bandra" }),
    visit({ placeId: "a", neighbourhood: "Bandra" }),
    visit({ placeId: "b", neighbourhood: "Colaba" }),
  ]);
  assert.equal(passport.cities[0].places, 2);
  assert.equal(passport.neighbourhoods.length, 2);
  assert.equal(passport.revisits, 1);
});

test("cuisine coverage folds case and handles multiple cuisines per place", () => {
  const passport = buildFoodPassport([
    visit({ placeId: "a", cuisines: ["Mughlai", "North Indian"] }),
    visit({ placeId: "b", cuisines: ["mughlai"] }),
  ]);
  assert.equal(passport.cuisines.length, 2);
  assert.equal(passport.cuisines[0].places, 2);
});

test("a place with no neighbourhood recorded does not create an empty bucket", () => {
  const passport = buildFoodPassport([visit({ neighbourhood: null })]);
  assert.deepEqual(passport.neighbourhoods, []);
});

test("an empty passport is a valid, zeroed passport", () => {
  const passport = buildFoodPassport([]);
  assert.equal(passport.distinctPlaces, 0);
  assert.equal(passport.firstVisitAt, null);
  assert.deepEqual(passport.cities, []);
});

test("milestones reward diversity, revisits and evidence, never review volume", () => {
  const passport = buildFoodPassport([
    visit({ placeId: "a", neighbourhood: "Bandra", cuisines: ["Mughlai"] }),
    visit({ placeId: "b", neighbourhood: "Colaba", cuisines: ["Levantine"] }),
  ]);
  const milestones = buildMilestones({
    passport,
    acceptedEvidence: 5,
    acceptedCorrections: 1,
    reverifiedStalePlaces: 0,
  });
  const byKey = new Map(milestones.map((milestone) => [milestone.key, milestone]));
  assert.equal(byKey.get("evidence")?.achieved, true);
  assert.equal(byKey.get("neighbourhoods")?.progress, 2);
  assert.equal(byKey.get("neighbourhoods")?.achieved, false);
  assert.ok(!milestones.some((milestone) => /review/i.test(milestone.description)));
});

test("milestone progress never exceeds its target", () => {
  const passport = buildFoodPassport(
    Array.from({ length: 40 }, (_, index) =>
      visit({ placeId: `place-${index}`, verified: true }),
    ),
  );
  const milestones = buildMilestones({
    passport,
    acceptedEvidence: 100,
    acceptedCorrections: 100,
    reverifiedStalePlaces: 100,
  });
  for (const milestone of milestones)
    assert.ok(milestone.progress <= milestone.target, milestone.key);
});
