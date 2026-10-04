import assert from "node:assert/strict";
import { test } from "node:test";
import { failureCopy } from "../src/lib/failure-copy";

test("each failure kind has its own copy and does not pretend the data is empty", () => {
  const cases = [401, 403, 404, 429, 503, "offline"] as const;
  const titles = cases.map((kind) => failureCopy(kind, "Your feed").title);
  assert.equal(new Set(titles).size, titles.length);
  for (const kind of cases) {
    const copy = failureCopy(kind, "Your feed");
    assert.match(copy.detail, /Nothing|nothing/);
    assert.equal(copy.title.toLowerCase().includes("no results"), false);
  }
  assert.equal(failureCopy(503, "Your feed").retry, true);
  assert.equal(failureCopy(401, "Your feed").retry, false);
  assert.match(failureCopy(503, "Your profile").title, /Your profile/);
});
