import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bboxParam,
  citySlugParam,
  limitParam,
  pageParam,
  placeIdParam,
} from "../src/lib/params";

test("viewport requires finite, ordered geographic bounds", () => {
  for (const value of [
    null,
    "",
    "1,2,3",
    "1,,3,4",
    "NaN,2,3,4",
    "-181,0,2,3",
    "0,20,30,10",
    "0,-91,1,2",
  ]) {
    assert.throws(() => bboxParam(value));
  }
  assert.deepEqual(bboxParam("170,-10,-170,10"), {
    west: 170,
    south: -10,
    east: -170,
    north: 10,
  });
});
test("result limits are bounded, including untrusted oversized input", () => {
  assert.equal(limitParam("12000"), 600);
  assert.equal(limitParam("12000", 40), 40);
  assert.equal(limitParam(null, 40), 40);
  for (const value of ["0", "-1", "NaN", "1.5", "1 OR 1=1"])
    assert.throws(() => limitParam(value));
});

test("city slugs accept only lowercase kebab-case identifiers", () => {
  assert.equal(citySlugParam("mumbai"), "mumbai");
  assert.equal(citySlugParam("new-york-city"), "new-york-city");
  assert.equal(citySlugParam("  Mumbai  "), "mumbai");
  assert.equal(citySlugParam("kuala-lumpur-2"), "kuala-lumpur-2");
  for (const value of [
    null,
    undefined,
    "",
    "-mumbai",
    "mumbai-",
    "new--york",
    "mumbai'; DROP TABLE places;--",
    "mumbai/../place",
    "mum bai",
    "café",
    "a".repeat(121),
  ])
    assert.equal(citySlugParam(value), null, JSON.stringify(value));
});

test("place ids accept only UUIDs", () => {
  const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  assert.equal(placeIdParam(id), id);
  assert.equal(placeIdParam(id.toUpperCase()), id);
  for (const value of [
    null,
    undefined,
    "",
    "search",
    "3f2504e0-4f89-11d3-9a0c",
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301x",
    "3f2504e0-4f89-11d3-9a0c-0305e82c330g",
    "' OR 1=1--",
  ])
    assert.equal(placeIdParam(value), null, JSON.stringify(value));
});

test("page index is clamped so deep pagination cannot walk the table", () => {
  assert.equal(pageParam("0"), 0);
  assert.equal(pageParam("7"), 7);
  assert.equal(pageParam(["3", "9"]), 3);
  assert.equal(pageParam("99999"), 200);
  assert.equal(pageParam("5", 2), 2);
  for (const value of [null, undefined, "", "-1", "1.5", "two", "1 OR 1=1"])
    assert.equal(pageParam(value), 0, JSON.stringify(value));
});
