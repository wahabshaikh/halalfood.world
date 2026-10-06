import assert from "node:assert/strict";
import test from "node:test";
import { buildFoodPassport, buildMilestones, type PassportCheck } from "./food-passport";

const check = (placeId: string, citySlug: string, cuisines: string[], country: string | null = "India"): PassportCheck => ({
  placeId,
  citySlug,
  cuisines,
  country,
  createdAt: 1,
});

test("the passport counts places, cities, cuisines, countries and went-back", () => {
  const passport = buildFoodPassport([
    check("a", "mumbai", ["Mughlai", "biryani"]),
    check("a", "mumbai", ["Mughlai"]),
    check("b", "delhi", ["Mughlai"]),
    check("c", "london", ["Turkish"], "United Kingdom"),
  ]);
  assert.deepEqual(passport, { checks: 4, places: 3, cities: 3, cuisines: 3, countries: 2, wentBack: 1 });
});

test("milestones show progress capped at the target", () => {
  const passport = buildFoodPassport([check("a", "mumbai", ["Mughlai"]), check("b", "pune", ["Irani"])]);
  const milestones = buildMilestones(passport, 0);
  assert.deepEqual(
    milestones.map((m) => [m.key, m.progress, m.target, m.achieved]),
    [
      ["first-check", 1, 1, true],
      ["first-verify", 0, 1, false],
      ["10-cuisines", 2, 10, false],
      ["regular", 0, 3, false],
      ["5-cities", 2, 5, false],
    ],
  );
});
