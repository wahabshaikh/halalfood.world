import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MAX_DISCOVERY_LAT_SPAN_DEGREES,
  MAX_DISCOVERY_LNG_SPAN_DEGREES,
  discoveryBboxExceedsCap,
  discoveryLngSpan,
} from "./discovery-bbox";

test("a city viewport is inside the cap", () => {
  const bbox = { west: 72.8, south: 19.0, east: 73.1, north: 19.3 };
  assert.ok(Math.abs(discoveryLngSpan(bbox) - 0.3) < 1e-9);
  assert.equal(discoveryBboxExceedsCap(bbox), false);
});

test("the cap is inclusive of an exact span", () => {
  assert.equal(
    discoveryBboxExceedsCap({
      west: 0,
      south: 0,
      east: MAX_DISCOVERY_LNG_SPAN_DEGREES,
      north: MAX_DISCOVERY_LAT_SPAN_DEGREES,
    }),
    false,
  );
});

test("a phone zoomed past the cap is rejected before a fetch", () => {
  assert.equal(
    discoveryBboxExceedsCap({ west: -10, south: 0, east: 10, north: 20.01 }),
    true,
  );
  assert.equal(
    discoveryBboxExceedsCap({
      west: 0,
      south: 0,
      east: MAX_DISCOVERY_LNG_SPAN_DEGREES + 0.01,
      north: 1,
    }),
    true,
  );
});

test("a box across the antimeridian uses the short way around", () => {
  const bbox = { west: 170, south: 10, east: -170, north: 12 };
  assert.equal(discoveryLngSpan(bbox), 20);
  assert.equal(discoveryBboxExceedsCap(bbox), false);
  assert.equal(
    discoveryBboxExceedsCap({ west: 100, south: 0, east: -100, north: 1 }),
    true,
  );
});

test("a world box is over the cap", () => {
  assert.equal(
    discoveryBboxExceedsCap({ west: -180, south: -90, east: 180, north: 90 }),
    true,
  );
});
