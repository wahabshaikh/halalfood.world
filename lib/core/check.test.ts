import { test } from "vitest";
import assert from "node:assert/strict";
import { checkOutcome, disagreesWith, validateCheck, verdictVerb } from "./check";

const base = { idempotencyKey: "abcdefgh1234" };

test("a check needs at least one definite answer", () => {
  assert.equal(validateCheck({ ...base, owned: "unsure" }).ok, false);
  assert.equal(validateCheck({ ...base }).ok, false);
  const ok = validateCheck({ ...base, pork: "no" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.owned, null);
    assert.equal(ok.value.shared, true);
  }
});

test("a check rejects unknown answers and verdicts", () => {
  assert.equal(validateCheck({ ...base, owned: "maybe" }).ok, false);
  assert.equal(validateCheck({ ...base, owned: "yes", verdict: "meh" }).ok, false);
});

test("dishes are trimmed, deduplicated and capped", () => {
  const result = validateCheck({ ...base, owned: "yes", dishes: [" Raan ", "raan", "", "Nihari"] });
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.value.dishes, ["Raan", "Nihari"]);
  assert.equal(validateCheck({ ...base, owned: "yes", dishes: ["a", "b", "c", "d", "e", "f"] }).ok, false);
});

test("photos are ids and the request key is required", () => {
  assert.equal(validateCheck({ ...base, owned: "yes", photoIds: ["photos/x.jpg"] }).ok, false);
  assert.equal(validateCheck({ ...base, owned: "yes", photoIds: ["3f2504e0-4f89-11d3-9a0c-0305e82c3301"] }).ok, true);
  assert.equal(validateCheck({ owned: "yes" }).ok, false);
});

test("outcome copy compares status before and after", () => {
  assert.match(checkOutcome({ kind: "checking", progress: 2 }, { kind: "verified" }, "Noor"), /is now Verified/);
  assert.match(checkOutcome({ kind: "verified" }, { kind: "verified" }, "Noor"), /stays Verified/);
  assert.match(checkOutcome({ kind: "checking", progress: 1 }, { kind: "checking", progress: 2 }, "Noor"), /2 of 3/);
  assert.match(checkOutcome({ kind: "checking", progress: 2 }, { kind: "checking", progress: 1 }, "Noor", { disagreed: true }), /differ/);
  assert.match(checkOutcome({ kind: "checking", progress: 1 }, { kind: "checking", progress: 1 }, "Noor"), /1 of 3/, "agreeing answers never read as a disagreement");
  assert.match(checkOutcome({ kind: "unchecked" }, { kind: "unchecked" }, "Noor", { counted: false }), /after 24 hours/);
  assert.equal(disagreesWith({ owned: "yes", certified: null, pork: "no", alcohol: "unsure" }, { owned: "yes", certified: "no", pork: null, alcohol: "yes" }), false);
  assert.equal(disagreesWith({ owned: "no", certified: null, pork: null, alcohol: null }, { owned: "yes", certified: null, pork: null, alcohol: null }), true);
  assert.match(checkOutcome({ kind: "unchecked" }, { kind: "checking", progress: 1 }, "Noor"), /1 of 3/);
  assert.equal(verdictVerb("loved"), "loved");
  assert.equal(verdictVerb("okay"), "checked");
});
