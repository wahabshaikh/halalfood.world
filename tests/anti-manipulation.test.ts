import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contributorWeight,
  detectAnomalies,
  evaluateDisclosure,
  safeMerchantTarget,
  trustRecoveryProgress,
} from "../src/lib/anti-manipulation";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const NOW = Date.parse("2026-09-17T12:00:00.000Z");

test("a merchant link may open a factual profile", () => {
  assert.deepEqual(safeMerchantTarget(`/place/${PLACE_ID}`), {
    ok: true,
    path: `/place/${PLACE_ID}`,
  });
  assert.deepEqual(safeMerchantTarget("/city/mumbai"), { ok: true, path: "/city/mumbai" });
});

test("a merchant link can never open a feedback flow", () => {
  for (const path of [
    `/place/${PLACE_ID}/checkin`,
    "/checkin/abc",
    "/review/new",
    "/rate?place=x",
  ]) {
    const result = safeMerchantTarget(path);
    assert.equal(result.ok, false, path);
  }
});

test("a merchant link cannot point off-platform", () => {
  for (const target of [
    "https://evil.example/review",
    "//evil.example",
    "javascript:alert(1)",
  ])
    assert.equal(safeMerchantTarget(target).ok, false, target);
});

test("rewarded feedback is labelled and excluded from ranking", () => {
  const outcome = evaluateDisclosure({ relationship: "none", incentivized: true });
  assert.equal(outcome.countsTowardsRanking, false);
  assert.match(outcome.publicLabel ?? "", /Rewarded/);
  assert.equal(outcome.requiresReview, false);
});

test("a declared relationship excludes without accusing", () => {
  const outcome = evaluateDisclosure({ relationship: "staff", incentivized: false });
  assert.equal(outcome.countsTowardsRanking, false);
  assert.equal(outcome.requiresReview, false);
});

test("a known but undisclosed affiliation is routed to review", () => {
  const outcome = evaluateDisclosure({
    relationship: "none",
    incentivized: false,
    knownAffiliation: "owner",
  });
  assert.equal(outcome.requiresReview, true);
  assert.match(outcome.publicLabel ?? "", /Undisclosed/);
});

test("an ordinary diner's feedback counts and carries no label", () => {
  assert.deepEqual(evaluateDisclosure({ relationship: "none", incentivized: false }), {
    countsTowardsRanking: true,
    publicLabel: null,
    requiresReview: false,
    reason: null,
  });
});

test("contributor weight stays within [0, 1] and penalises new, inaccurate, bursty accounts", () => {
  const established = contributorWeight({
    accountAgeDays: 400,
    acceptedContributions: 40,
    rejectedContributions: 0,
    recentSubmissionsHere: 1,
  });
  assert.equal(established, 1);

  const brandNew = contributorWeight({
    accountAgeDays: 0,
    acceptedContributions: 0,
    rejectedContributions: 0,
    recentSubmissionsHere: 1,
  });
  assert.ok(brandNew > 0 && brandNew < 0.5, `got ${brandNew}`);

  const bursty = contributorWeight({
    accountAgeDays: 400,
    acceptedContributions: 40,
    rejectedContributions: 0,
    recentSubmissionsHere: 5,
  });
  assert.ok(bursty < established);

  const inaccurate = contributorWeight({
    accountAgeDays: 400,
    acceptedContributions: 1,
    rejectedContributions: 9,
    recentSubmissionsHere: 1,
  });
  assert.ok(inaccurate <= 0.2 + 1e-9 && inaccurate > 0);
});

test("bursts and single-account dominance are flagged, not deleted", () => {
  const burst = detectAnomalies(
    Array.from({ length: 6 }, (_, index) => ({
      userId: `user-${index}`,
      createdAt: NOW - index * 60_000,
    })),
    NOW,
  );
  assert.ok(burst.some((finding) => finding.code === "burst"));

  const dominated = detectAnomalies(
    [
      { userId: "user-1", createdAt: NOW - 10 * 86_400_000 },
      { userId: "user-1", createdAt: NOW - 9 * 86_400_000 },
      { userId: "user-1", createdAt: NOW - 8 * 86_400_000 },
      { userId: "user-2", createdAt: NOW - 7 * 86_400_000 },
    ],
    NOW,
  );
  assert.ok(dominated.some((finding) => finding.code === "single-account-dominance"));
});

test("quiet, spread-out activity raises nothing", () => {
  assert.deepEqual(
    detectAnomalies(
      [
        { userId: "user-1", createdAt: NOW - 30 * 86_400_000 },
        { userId: "user-2", createdAt: NOW - 20 * 86_400_000 },
      ],
      NOW,
    ),
    [],
  );
});

test("credibility can recover after a proportionate restriction", () => {
  assert.deepEqual(
    trustRecoveryProgress({
      restrictedUntil: NOW + 86_400_000,
      acceptedSinceRestriction: 0,
      now: NOW,
    }),
    { restricted: true, recovered: false, remaining: 5 },
  );
  assert.deepEqual(
    trustRecoveryProgress({
      restrictedUntil: NOW - 1,
      acceptedSinceRestriction: 5,
      now: NOW,
    }),
    { restricted: false, recovered: true, remaining: 0 },
  );
});
