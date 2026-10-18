import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeSearchQuery, splitCityQuery } from "./search-query";

const cities = ["mumbai", "new-york", "new-york-city"];

test("city queries recognise either end, case-insensitively, preferring the longest city", () => {
  assert.deepEqual(splitCityQuery("Mumbai biryani", cities), { citySlug: "mumbai", rest: "biryani" });
  assert.deepEqual(splitCityQuery("biryani MUMBAI", cities), { citySlug: "mumbai", rest: "biryani" });
  assert.deepEqual(splitCityQuery("new york city halal guys", cities), { citySlug: "new-york-city", rest: "halal guys" });
  assert.deepEqual(splitCityQuery("halal guys new york city", cities), { citySlug: "new-york-city", rest: "halal guys" });
  assert.deepEqual(splitCityQuery("the kebab shop", cities), { citySlug: null, rest: "the kebab shop" });
  assert.deepEqual(splitCityQuery("mumbaikar biryani", cities), { citySlug: null, rest: "mumbaikar biryani" });
  assert.deepEqual(splitCityQuery("best mumbai biryani", cities), { citySlug: null, rest: "best mumbai biryani" });
});

test("city splitting handles empty rest, whitespace and the 64-character query cap", () => {
  assert.deepEqual(splitCityQuery("  NEW  YORK CITY  ", cities), { citySlug: "new-york-city", rest: "" });
  assert.deepEqual(splitCityQuery("", cities), { citySlug: null, rest: "" });
  const q = `mumbai ${"a".repeat(57)}`;
  assert.equal(q.length, 64);
  assert.deepEqual(splitCityQuery(q, cities), { citySlug: "mumbai", rest: "a".repeat(57) });
  assert.equal(normalizeSearchQuery(`${q} extra`), q);
  assert.equal(Array.from(normalizeSearchQuery("😀".repeat(65))).length, 64);
});
