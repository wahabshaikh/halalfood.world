import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accuracy,
  canAutoPublish,
  canResolveDisputes,
  canReviewDisputes,
  earnedRole,
  type Standing,
} from "../src/lib/reputation";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const DAY = 86_400_000;

function standing(overrides: Partial<Standing> = {}): Standing {
  return {
    role: "new",
    accepted: 0,
    rejected: 0,
    verifiedVisits: 0,
    citySlug: null,
    restrictedUntil: null,
    acceptedSinceRestriction: 0,
    ...overrides,
  };
}

test("a new account starts at the bottom of the ladder", () => {
  assert.equal(earnedRole(standing(), NOW).role, "new");
});

test("promotion follows accuracy, not volume", () => {
  // Prolific but frequently wrong: no promotion.
  const sloppy = earnedRole(
    standing({ accepted: 40, rejected: 60, verifiedVisits: 20 }),
    NOW,
  );
  assert.equal(sloppy.role, "new");

  // Fewer contributions, consistently accepted: promoted.
  const careful = earnedRole(standing({ accepted: 16, rejected: 1, verifiedVisits: 3 }), NOW);
  assert.equal(careful.role, "trusted");
});

test("each rung needs accepted volume, accuracy and verified visits together", () => {
  // Accurate and prolific, but no verified visits: held below trusted.
  assert.equal(
    earnedRole(standing({ accepted: 60, rejected: 2, verifiedVisits: 0 }), NOW).role,
    "contributor",
  );
  assert.equal(
    earnedRole(standing({ accepted: 60, rejected: 2, verifiedVisits: 20 }), NOW).role,
    "city-expert",
  );
});

test("a live restriction holds the ladder at new", () => {
  const promotion = earnedRole(
    standing({
      role: "trusted",
      accepted: 40,
      rejected: 1,
      verifiedVisits: 10,
      restrictedUntil: NOW + DAY,
    }),
    NOW,
  );
  assert.equal(promotion.role, "new");
  assert.equal(promotion.changed, true);
  assert.match(promotion.reason, /restriction/);
});

test("credibility recovers through accepted work after a restriction expires", () => {
  const rebuilding = earnedRole(
    standing({
      accepted: 40,
      rejected: 1,
      verifiedVisits: 10,
      restrictedUntil: NOW - DAY,
      acceptedSinceRestriction: 2,
    }),
    NOW,
  );
  assert.equal(rebuilding.role, "new");
  assert.match(rebuilding.reason, /3 more accepted/);

  const recovered = earnedRole(
    standing({
      accepted: 40,
      rejected: 1,
      verifiedVisits: 10,
      restrictedUntil: NOW - DAY,
      acceptedSinceRestriction: 5,
    }),
    NOW,
  );
  // 40 accepted is above the trusted bar and below the city-expert one.
  assert.equal(recovered.role, "trusted");
});

test("city moderator is granted by a human and never auto-computed", () => {
  const promotion = earnedRole(standing({ role: "city-moderator" }), NOW);
  assert.equal(promotion.role, "city-moderator");
  assert.equal(promotion.changed, false);
  // Nothing in the requirements can reach it automatically.
  assert.notEqual(
    earnedRole(standing({ accepted: 100000, rejected: 0, verifiedVisits: 1000 }), NOW).role,
    "city-moderator",
  );
});

test("accuracy is one when nothing has been decided", () => {
  assert.equal(accuracy({ accepted: 0, rejected: 0 }), 1);
  assert.equal(accuracy({ accepted: 3, rejected: 1 }), 0.75);
});

test("privileges are gated by rung", () => {
  assert.equal(canAutoPublish("new"), false);
  assert.equal(canAutoPublish("contributor"), true);
  assert.equal(canReviewDisputes("contributor"), false);
  assert.equal(canReviewDisputes("trusted"), true);
  assert.equal(canResolveDisputes("city-expert"), false);
  assert.equal(canResolveDisputes("city-moderator"), true);
});
