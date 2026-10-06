import assert from "node:assert/strict";
import { test } from "vitest";
import { parseTestSessionInput } from "./test-session";

test("a test session needs only an email and defaults to an onboarded, old enough account", () => {
  assert.deepEqual(parseTestSessionInput({ email: " A@Example.com " }), {
    email: "a@example.com",
    name: undefined,
    onboarded: true,
    moderator: false,
    ageDays: undefined,
  });
});

test("test session fields are validated", () => {
  assert.deepEqual(parseTestSessionInput(null), { error: "Send a JSON object." });
  assert.deepEqual(parseTestSessionInput({ email: "nope" }), { error: "Send a valid email." });
  assert.deepEqual(parseTestSessionInput({ email: "a@b.co", name: "" }), { error: "name must be a non-empty string." });
  assert.deepEqual(parseTestSessionInput({ email: "a@b.co", onboarded: "yes" }), { error: "onboarded must be true or false." });
  assert.deepEqual(parseTestSessionInput({ email: "a@b.co", moderator: 1 }), { error: "moderator must be true or false." });
  assert.deepEqual(parseTestSessionInput({ email: "a@b.co", ageDays: -1 }), { error: "ageDays must be a number from 0 to 3650." });
  assert.equal("error" in parseTestSessionInput({ email: "a@b.co", onboarded: false, moderator: true, ageDays: 2, name: "Ayesha" }), false);
});
