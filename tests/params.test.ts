import { test } from "node:test";
import assert from "node:assert/strict";
import { bboxParam, limitParam } from "../src/lib/params";

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
