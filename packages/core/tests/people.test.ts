import assert from "node:assert/strict";
import test from "node:test";
import { decideFollow, handleFromEmail, validateBio, validateDisplayName, validateHandle } from "../src/people";

test("handles are 3–30 of a-z, 0-9, _ and .", () => {
  assert.deepEqual(validateHandle("@Sara.K"), { ok: true, handle: "sara.k" });
  assert.equal(validateHandle("ab").ok, false);
  assert.equal(validateHandle("has-dash").ok, false);
  assert.equal(validateHandle("a".repeat(31)).ok, false);
  assert.equal(validateHandle(".dot").ok, false);
  assert.equal(validateHandle("two..dots").ok, false);
  assert.equal(validateHandle("admin").ok, false);
});

test("a starting handle comes from the email's local part", () => {
  assert.equal(handleFromEmail("Sara.K+food@example.com"), "sara.k");
  assert.equal(handleFromEmail("a@example.com"), "aeats");
  assert.equal(handleFromEmail("admin@example.com"), "admin_eats");
  for (const email of ["Sara.K+food@example.com", "a@example.com", "x-y-z@example.com", "admin@example.com"])
    assert.equal(validateHandle(handleFromEmail(email)).ok, true, email);
});

test("names and bios are cleaned and bounded", () => {
  assert.deepEqual(validateDisplayName("  Sara   K "), { ok: true, displayName: "Sara K" });
  assert.equal(validateDisplayName("sara@example.com").ok, false);
  assert.deepEqual(validateBio("  "), { ok: true, bio: null });
  assert.equal(validateBio("x".repeat(161)).ok, false);
});

test("following a private account is a request; blocks refuse", () => {
  const base = { followerId: "a", followeeId: "b", followeeIsPrivate: false, blockedEitherWay: false, existing: null };
  assert.deepEqual(decideFollow(base), { action: "follow", status: "accepted" });
  assert.deepEqual(decideFollow({ ...base, followeeIsPrivate: true }), { action: "follow", status: "pending" });
  assert.deepEqual(decideFollow({ ...base, blockedEitherWay: true }), { action: "reject", reason: "blocked" });
  assert.deepEqual(decideFollow({ ...base, followeeId: "a" }), { action: "reject", reason: "self" });
});
