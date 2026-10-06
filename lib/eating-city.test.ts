import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eatingCityOptions,
  homePickerCities,
  resolveEatingCity,
  safeNextPath,
} from "./eating-city";

const cities = [{ city_slug: "delhi" }, { city_slug: "mumbai" }, { city_slug: "bhopal" }];

test("a denied or stale network location does not choose the eating city", () => {
  assert.deepEqual(
    resolveEatingCity({ query: null, cookie: null, cities }),
    { slug: null, source: "none" },
  );
  assert.deepEqual(
    resolveEatingCity({ query: "not a city", cookie: "dadri", cities }),
    { slug: null, source: "none" },
  );
});

test("the visitor's city wins over the cookie and must be a listed city", () => {
  assert.deepEqual(
    resolveEatingCity({ query: "delhi", cookie: "mumbai", cities }),
    { slug: "delhi", source: "choice" },
  );
  assert.deepEqual(
    resolveEatingCity({ cookie: "mumbai", cities }),
    { slug: "mumbai", source: "choice" },
  );
});

test("the home city picker stays available when listings fail to load", () => {
  assert.deepEqual(
    homePickerCities(null, cities).map((city) => city.city_slug),
    ["delhi", "mumbai", "bhopal"],
  );
  assert.deepEqual(
    homePickerCities([{ city_slug: "delhi" }], cities).map((city) => city.city_slug),
    ["delhi"],
  );
  assert.deepEqual(homePickerCities([], cities), cities);
});

test("city options are alphabetical and the redirect stays on this site", () => {
  assert.deepEqual(
    eatingCityOptions(cities).map((city) => city.city_slug),
    ["bhopal", "delhi", "mumbai"],
  );
  assert.equal(safeNextPath("/map?city=delhi"), "/map?city=delhi");
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("/eating?city=delhi"), "/");
});
