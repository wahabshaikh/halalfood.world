import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOnboardingStandard,
  avatarUrl,
  decideFollow,
  describeStandard,
  inviteLink,
  profileAccess,
  relationOf,
  validateDisplayName,
  validateHandle,
  validateOnboarding,
} from "../src/social";
import { DEFAULT_PREFERENCES, validatePreferences } from "../src/user-preferences";

const PLACE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("handles are normalised and checked against the public profile shape", () => {
  assert.deepEqual(validateHandle("  @Ayesha_Eats "), { ok: true, handle: "ayesha_eats" });
  assert.equal(validateHandle("ab").ok, false);
  assert.equal(validateHandle("has space").ok, false);
  assert.equal(validateHandle("-leading").ok, false);
  assert.equal(validateHandle(null).ok, false);
});

test("reserved and derived handles cannot be chosen", () => {
  assert.equal(validateHandle("admin").ok, false);
  assert.equal(validateHandle("halalfood").ok, false);
  assert.equal(validateHandle("diner-0123456789").ok, false);
  assert.equal(validateHandle("diner-fan").ok, true);
});

test("display names are trimmed, collapsed and length limited", () => {
  assert.deepEqual(validateDisplayName("  Ayesha \n  Khan "), {
    ok: true,
    displayName: "Ayesha Khan",
  });
  assert.equal(validateDisplayName("   ").ok, false);
  assert.equal(validateDisplayName("qa@example.com").ok, false);
  assert.equal(validateDisplayName("x".repeat(61)).ok, false);
  assert.equal(validateDisplayName(42).ok, false);
});

test("following a public account is accepted, a private one is a request", () => {
  const base = {
    followerId: "a",
    followeeId: "b",
    blockedEitherWay: false,
    existing: null,
  } as const;
  assert.deepEqual(decideFollow({ ...base, followeeIsPrivate: false }), {
    action: "follow",
    status: "accepted",
  });
  assert.deepEqual(decideFollow({ ...base, followeeIsPrivate: true }), {
    action: "follow",
    status: "pending",
  });
});

test("following twice, yourself or across a block does not create a follow", () => {
  const base = { followerId: "a", followeeId: "b", followeeIsPrivate: false } as const;
  assert.deepEqual(
    decideFollow({ ...base, blockedEitherWay: false, existing: "pending" }),
    { action: "noop", status: "pending" },
  );
  assert.deepEqual(
    decideFollow({ ...base, followeeId: "a", blockedEitherWay: false, existing: null }),
    { action: "reject", reason: "self" },
  );
  assert.deepEqual(
    decideFollow({ ...base, blockedEitherWay: true, existing: null }),
    { action: "reject", reason: "blocked" },
  );
});

test("relation prefers self, then block, then follow state", () => {
  const base = { profileUserId: "b", blockedEitherWay: false, follow: null } as const;
  assert.equal(relationOf({ ...base, viewerId: "b" }), "self");
  assert.equal(relationOf({ ...base, viewerId: null }), "none");
  assert.equal(relationOf({ ...base, viewerId: "a", blockedEitherWay: true, follow: "accepted" }), "blocked");
  assert.equal(relationOf({ ...base, viewerId: "a", follow: "accepted" }), "following");
  assert.equal(relationOf({ ...base, viewerId: "a", follow: "pending" }), "requested");
});

test("a private account shows activity only to accepted followers", () => {
  assert.equal(profileAccess("none", true).showsActivity, false);
  assert.equal(profileAccess("requested", true).showsActivity, false);
  assert.equal(profileAccess("following", true).showsActivity, true);
  assert.equal(profileAccess("self", true).showsActivity, true);
  assert.equal(profileAccess("none", false).showsActivity, true);
  assert.equal(profileAccess("none", true).showsIdentity, true);
  assert.equal(profileAccess("none", true).canFollow, true);
  assert.equal(profileAccess("following", true).canFollow, false);
});

test("a blocked viewer sees nothing and cannot follow", () => {
  assert.deepEqual(profileAccess("blocked", false), {
    showsIdentity: false,
    showsActivity: false,
    canFollow: false,
  });
});

test("the onboarding standard writes the same fields as the standards page", () => {
  const applied = applyOnboardingStandard(
    { ...DEFAULT_PREFERENCES, allergies: ["peanut"], avoidPork: true },
    { preset: "certified", avoidAlcohol: true, preferHandSlaughter: true },
  );
  assert.equal(applied.minimumStatus, "verified");
  assert.equal(applied.requireCertification, true);
  assert.equal(applied.avoidAlcohol, true);
  assert.equal(applied.preferHandSlaughter, true);
  // Answers the step never asks about survive.
  assert.deepEqual(applied.allergies, ["peanut"]);
  assert.equal(applied.avoidPork, true);
  assert.equal(validatePreferences(applied).ok, true);
});

test("every onboarding preset yields preferences the standards page accepts", () => {
  for (const preset of ["certified", "community", "options"] as const) {
    const applied = applyOnboardingStandard(DEFAULT_PREFERENCES, {
      preset,
      avoidAlcohol: false,
      preferHandSlaughter: false,
    });
    assert.equal(validatePreferences(applied).ok, true, preset);
  }
});

test("the current standard is described in words", () => {
  const preferences = applyOnboardingStandard(DEFAULT_PREFERENCES, {
    preset: "certified",
    avoidAlcohol: true,
    preferHandSlaughter: false,
  });
  assert.equal(describeStandard(preferences), "Certified only · No alcohol");
  assert.equal(
    describeStandard({ ...DEFAULT_PREFERENCES, minimumStatus: "verified" }),
    "Custom standard",
  );
});

test("onboarding needs a name and a handle and nothing else", () => {
  const minimal = validateOnboarding({ displayName: "Ayesha Khan", handle: "Ayesha.Eats" });
  assert.equal(minimal.ok, false);
  const ok = validateOnboarding({ displayName: "Ayesha Khan", handle: "ayesha_eats" });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.deepEqual(ok.data, {
    displayName: "Ayesha Khan",
    handle: "ayesha_eats",
    standard: null,
    homeCitySlug: null,
    wantToTry: [],
    invitedByHandle: null,
  });
});

test("onboarding validates the standard, picks, city and invite", () => {
  const base = { displayName: "Ayesha", handle: "ayesha_eats" };
  assert.equal(validateOnboarding({ ...base, standard: { preset: "strict" } }).ok, false);
  assert.equal(validateOnboarding({ ...base, wantToTry: [PLACE, "x"] }).ok, false);
  const other = (n: number) => `3f2504e0-4f89-11d3-9a0c-0305e82c33${String(n).padStart(2, "0")}`;
  assert.equal(validateOnboarding({ ...base, wantToTry: [1, 2, 3, 4].map(other) }).ok, false);
  assert.equal(validateOnboarding({ ...base, wantToTry: [1, 2, 3].map(other) }).ok, true);
  assert.equal(validateOnboarding({ ...base, homeCitySlug: "Not A Slug" }).ok, false);
  assert.equal(validateOnboarding({ ...base, invitedByHandle: "!" }).ok, false);

  const full = validateOnboarding({
    ...base,
    standard: { preset: "options", avoidAlcohol: true },
    wantToTry: [PLACE, PLACE.toUpperCase()],
    homeCitySlug: "mumbai",
    invitedByHandle: "@Zaid",
  });
  assert.equal(full.ok, true);
  if (!full.ok) return;
  assert.deepEqual(full.data.standard, {
    preset: "options",
    avoidAlcohol: true,
    preferHandSlaughter: false,
  });
  assert.deepEqual(full.data.wantToTry, [PLACE]);
  assert.equal(full.data.homeCitySlug, "mumbai");
  assert.equal(full.data.invitedByHandle, "zaid");
});

test("avatar URLs are versioned by the stored file and empty without a photo", () => {
  assert.equal(avatarUrl("zaid", null), null);
  assert.equal(
    avatarUrl("zaid", `avatars/${"a".repeat(64)}/3f2504e0-4f89-11d3-9a0c-0305e82c3301.jpg`),
    "/api/avatars/zaid?v=3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  );
});

test("an invite link names only the inviter", () => {
  assert.equal(inviteLink("zaid"), "https://halalfood.world/invite/zaid");
  assert.equal(inviteLink("zaid", "http://localhost:3000/"), "http://localhost:3000/invite/zaid");
});
