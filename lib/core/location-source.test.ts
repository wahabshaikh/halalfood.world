import assert from "node:assert/strict";
import { test } from "vitest";
import { LOCATION_SOURCES, locationSource } from "./location-source";

test("only known location sources are accepted", () => {
  for (const source of LOCATION_SOURCES) assert.equal(locationSource(source), source);
  for (const value of [undefined, null, "", "SCOUT", "other", 1]) assert.equal(locationSource(value), null);
});
