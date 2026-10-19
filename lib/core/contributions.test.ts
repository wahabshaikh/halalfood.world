import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CONTRIBUTION_KINDS,
  DAILY_POINTS_CAP,
  POINT_RULES,
  canMoveTo,
  parseChannel,
  parseContributionKind,
  parseContributionStatus,
  parsePointStatus,
  parseVouchRating,
  pointStatusFor,
  pointsToGrant,
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
