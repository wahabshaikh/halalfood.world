import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CONTRIBUTION_KINDS,
  DAILY_POINTS_CAP,
  POINT_RULES,
  VOUCH_NOTE_MAX,
  canMoveTo,
  ipNetwork,
  parseChannel,
  parseContributionKind,
  parseContributionStatus,
  parsePointStatus,
  parseVouchRating,
  pointStatusFor,
  pointsToGrant,
  validateVouch,
} from "./contributions";

const fresh = { points: 0, awards: 0 };

test("only known kinds, channels, statuses and ratings parse", () => {
  for (const kind of CONTRIBUTION_KINDS) assert.equal(parseContributionKind(kind), kind);
  assert.equal(parseContributionKind("check"), null);
  assert.equal(parseChannel("mcp"), "mcp");
  assert.equal(parseChannel("app"), null);
  assert.equal(parseContributionStatus("reverted"), "reverted");
  assert.equal(parseContributionStatus("approved"), null);
  assert.equal(parsePointStatus("granted"), "granted");
  assert.equal(parsePointStatus(1), null);
  assert.equal(parseVouchRating("loved"), "loved");
  assert.equal(parseVouchRating("hated"), null);
});

test("pending work is accepted or rejected; only accepted work can be reverted", () => {
  assert.equal(canMoveTo("pending", "accepted"), true);
  assert.equal(canMoveTo("pending", "rejected"), true);
  assert.equal(canMoveTo("accepted", "reverted"), true);
  assert.equal(canMoveTo("pending", "reverted"), false);
  assert.equal(canMoveTo("accepted", "rejected"), false);
  assert.equal(canMoveTo("rejected", "accepted"), false);
  assert.equal(canMoveTo("reverted", "accepted"), false);
});

test("points are pending until accepted, granted on acceptance and revoked otherwise", () => {
  assert.equal(pointStatusFor("pending"), "pending");
  assert.equal(pointStatusFor("accepted"), "granted");
  assert.equal(pointStatusFor("rejected"), "revoked");
  assert.equal(pointStatusFor("reverted"), "revoked");
});

test("each kind pays its section 4 points; ratings never pay", () => {
  const expected = {
    vouch: 3,
    place_add: 5,
    video: 5,
    photo: 1,
    menu: 5,
    certificate: 10,
    owner_claim: 10,
    edit: 1,
    rating: 0,
    amenity: 1,
    hours: 1,
    link: 1,
  };
  for (const kind of CONTRIBUTION_KINDS) assert.equal(pointsToGrant(kind, fresh), expected[kind], kind);
});

test("a video pays 2 more per place published from it", () => {
  assert.equal(pointsToGrant("video", fresh, { placesPublished: 3 }), 11);
  assert.equal(pointsToGrant("video", fresh, { placesPublished: -1 }), 5);
  assert.equal(pointsToGrant("photo", fresh, { placesPublished: 3 }), 1);
});

test("a vouch pays once per place, ever", () => {
  assert.equal(pointsToGrant("vouch", fresh, { paidBefore: false }), 3);
  assert.equal(pointsToGrant("vouch", fresh, { paidBefore: true }), 0);
  assert.equal(pointsToGrant("menu", fresh, { paidBefore: true }), 5);
});

test("a kind stops paying at its daily cap; hours, links, amenities and edits share one", () => {
  assert.equal(pointsToGrant("place_add", { points: 50, awards: 9 }), 5);
  assert.equal(pointsToGrant("place_add", { points: 50, awards: 10 }), 0);
  assert.equal(pointsToGrant("certificate", { points: 50, awards: 5 }), 0);
  assert.equal(pointsToGrant("owner_claim", { points: 50, awards: 99 }), 10);
  for (const kind of ["hours", "link", "amenity", "edit"] as const) {
    assert.equal(POINT_RULES[kind].group, "details");
    assert.equal(pointsToGrant(kind, { points: 0, awards: 20 }), 0, kind);
  }
});

test("no more than 100 points a day: the last award is trimmed, then nothing pays", () => {
  assert.equal(DAILY_POINTS_CAP, 100);
  assert.equal(pointsToGrant("certificate", { points: 90, awards: 0 }), 10);
  assert.equal(pointsToGrant("certificate", { points: 95, awards: 0 }), 5);
  assert.equal(pointsToGrant("vouch", { points: 100, awards: 0 }), 0);
  assert.equal(pointsToGrant("vouch", { points: 120, awards: 0 }), 0);
});

test("a vouch needs a past month and takes an optional rating and a short note", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  assert.deepEqual(validateVouch({}, now), { ok: true, value: { ateAt: "2026-10", rating: null, note: null } });
  assert.deepEqual(validateVouch({ ateAt: "2026-08", rating: "loved", note: "  Great biryani  " }, now), {
    ok: true,
    value: { ateAt: "2026-08", rating: "loved", note: "Great biryani" },
  });
  assert.deepEqual(validateVouch({ rating: "", note: "   " }, now), { ok: true, value: { ateAt: "2026-10", rating: null, note: null } });
  for (const body of [null, [], "x"]) assert.equal(validateVouch(body, now).ok, false);
  for (const ateAt of ["2026-11", "1999-12", "2026-13", "2026-1", 202610]) assert.equal(validateVouch({ ateAt }, now).ok, false);
  assert.deepEqual(validateVouch({ rating: "hated" }, now), { ok: false, error: "Choose disliked, liked or loved." });
  assert.deepEqual(validateVouch({ note: 5 }, now), { ok: false, error: "The note must be text." });
  assert.equal(validateVouch({ note: "x".repeat(VOUCH_NOTE_MAX) }, now).ok, true);
  assert.equal(validateVouch({ note: "x".repeat(VOUCH_NOTE_MAX + 1) }, now).ok, false);
});

test("an IP maps to its /24 or /48 network", () => {
  assert.equal(ipNetwork("203.0.113.77"), "203.0.113.0/24");
  assert.equal(ipNetwork("203.0.113.300"), null);
  assert.equal(ipNetwork("2001:db8:85a3::8a2e:370:7334"), "2001:db8:85a3::/48");
  assert.equal(ipNetwork("2001:0db8:0000:0042:0000:8a2e:0370:7334"), "2001:db8:0::/48");
  assert.equal(ipNetwork("::1"), "0:0:0::/48");
  assert.equal(ipNetwork("unknown"), null);
  assert.equal(ipNetwork("1:2:3"), null);
  assert.equal(ipNetwork("12345::"), null);
});
