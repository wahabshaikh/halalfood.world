import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cityDemandScore,
  coverageHeadline,
  coverageLevel,
  summarizeCityCoverage,
  type CoverageInputs,
} from "../src/lib/coverage";

function inputs(overrides: Partial<CoverageInputs> = {}): CoverageInputs {
  return {
    evidenceCount: 0,
    observationCount: 0,
    dishCount: 0,
    checkInCount: 0,
    verifiedCheckInCount: 0,
    distinctContributors: 0,
    hasInspection: false,
    ...overrides,
  };
}

test("a bare place is indexed, not enriched", () => {
  assert.equal(coverageLevel(inputs()), "indexed");
});

test("attached observations, dishes or an inspection make a place enriched", () => {
  assert.equal(coverageLevel(inputs({ observationCount: 3 })), "enriched");
  assert.equal(coverageLevel(inputs({ dishCount: 1 })), "enriched");
  assert.equal(coverageLevel(inputs({ hasInspection: true })), "enriched");
});

test("intelligent needs halal evidence plus real dish or visit signal", () => {
  assert.equal(coverageLevel(inputs({ evidenceCount: 1 })), "indexed");
  assert.equal(coverageLevel(inputs({ evidenceCount: 1, dishCount: 3 })), "intelligent");
  assert.equal(coverageLevel(inputs({ evidenceCount: 1, checkInCount: 3 })), "intelligent");
});

test("trusted needs verified first-hand depth from several contributors", () => {
  assert.equal(
    coverageLevel(
      inputs({
        evidenceCount: 2,
        dishCount: 3,
        checkInCount: 5,
        verifiedCheckInCount: 5,
        distinctContributors: 3,
      }),
    ),
    "trusted",
  );
  // One prolific contributor is not a trusted city.
  assert.equal(
    coverageLevel(
      inputs({
        evidenceCount: 2,
        dishCount: 3,
        checkInCount: 20,
        verifiedCheckInCount: 20,
        distinctContributors: 1,
      }),
    ),
    "intelligent",
  );
});

test("a city with nothing enriched says so instead of rounding up", () => {
  const coverage = summarizeCityCoverage("london", { indexed: 400 });
  assert.equal(coverage.enrichedPercent, 0);
  assert.match(coverageHeadline(coverage), /none enriched yet/);
});

test("an unindexed city is described honestly", () => {
  assert.match(coverageHeadline(summarizeCityCoverage("lagos", {})), /not indexed yet/);
});

test("coverage percentage counts everything at enriched or better", () => {
  const coverage = summarizeCityCoverage("mumbai", {
    indexed: 50,
    enriched: 30,
    intelligent: 15,
    trusted: 5,
  });
  assert.equal(coverage.total, 100);
  assert.equal(coverage.enrichedPercent, 50);
  assert.match(coverageHeadline(coverage), /Mumbai is 50% enriched/);
});

test("demand rises with requests and contributors, and falls as a city fills up", () => {
  const base = { requests: 10, searches: 50, placeViews: 200, contributors: 0 };
  const empty = cityDemandScore({ ...base, enrichedPercent: 0 });
  const half = cityDemandScore({ ...base, enrichedPercent: 50 });
  const full = cityDemandScore({ ...base, enrichedPercent: 100 });
  assert.ok(empty > half && half > full);

  const withHelpers = cityDemandScore({ ...base, contributors: 10, enrichedPercent: 0 });
  assert.ok(withHelpers > empty);
});

test("a request counts for far more than a passive view", () => {
  const requested = cityDemandScore({
    requests: 1,
    searches: 0,
    placeViews: 0,
    contributors: 0,
    enrichedPercent: 0,
  });
  const viewed = cityDemandScore({
    requests: 0,
    searches: 0,
    placeViews: 1,
    contributors: 0,
    enrichedPercent: 0,
  });
  assert.ok(requested > viewed);
});
