import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  filtersFromStandards,
  parseDiscoveryFilters,
  serializeDiscoveryFilters,
} from "../src/discovery-filters";

function parse(query: string) {
  return parseDiscoveryFilters(new URLSearchParams(query));
}

test("an empty query yields the default filter set", () => {
  assert.deepEqual(parse(""), EMPTY_FILTERS);
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
});

test("unknown values are dropped rather than rejected", () => {
  const filters = parse(
    "status=verified,made-up&facts=noAlcohol,teleport&price=2,9&service=delivery,rocket&meal=dinner,brunch&sort=nonsense",
  );
  assert.deepEqual(filters.statuses, ["verified"]);
  assert.deepEqual(filters.facts, ["noAlcohol"]);
  assert.deepEqual(filters.priceBands, [2]);
  assert.deepEqual(filters.serviceTypes, ["delivery"]);
  assert.deepEqual(filters.meals, ["dinner"]);
  assert.equal(filters.sort, "recommended");
});

test("filters round-trip through the query string", () => {
  const query =
    "cuisine=mughlai&dish=biryani&facts=noAlcohol%2CprayerSpace&meal=dinner&mine=1&open=1&price=1%2C2&q=bandra&service=dine-in&sort=would-return&status=verified%2Ccommunity-verified&within=2.5";
  const filters = parse(query);
  const round = parseDiscoveryFilters(
    new URLSearchParams(serializeDiscoveryFilters(filters)),
  );
  assert.deepEqual(round, filters);
});

test("the active filter count drives the Filters chip badge", () => {
  const filters = parse("status=verified&facts=noAlcohol,noPork&open=1&within=3");
  assert.equal(activeFilterCount(filters), 5);
});

test("a distance beyond the allowed range is ignored", () => {
  assert.equal(parse("within=0").maxDistanceKm, null);
  assert.equal(parse("within=250").maxDistanceKm, null);
  assert.equal(parse("within=1.25").maxDistanceKm, 1.3);
});

test("saved standards become visible filter selections", () => {
  const derived = filtersFromStandards({
    minimumStatus: "community-verified",
    requireCertification: true,
    avoidAlcohol: true,
    avoidPork: false,
    requireDedicatedKitchen: false,
    requirePrayerSpace: true,
    vegetarianOnly: false,
  });
  assert.deepEqual(derived.statuses, ["verified", "community-verified"]);
  assert.deepEqual(derived.facts, ["certified", "noAlcohol", "prayerSpace"]);
  // Not halal is never selectable through a personal standard.
  assert.ok(!derived.statuses.includes("not-halal"));
});

test("a search term longer than the cap is dropped, not truncated", () => {
  assert.equal(parse(`q=${"a".repeat(200)}`).q, null);
  assert.equal(parse("q=%20%20").q, null);
});
