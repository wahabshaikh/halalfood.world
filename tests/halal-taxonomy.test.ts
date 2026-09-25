import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EVIDENCE_TTL_DAYS,
  deriveHalalAssessment,
  effectiveExpiry,
  evidenceSupports,
  formatEvidenceAge,
  meetsMinimumStatus,
  type EvidenceRecord,
} from "../src/lib/halal-taxonomy";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const DAY = 86_400_000;

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: overrides.id ?? `evidence-${Math.random().toString(16).slice(2)}`,
    kind: "first-hand",
    claimedStatus: "community-verified",
    scope: "venue",
    capturedAt: NOW - 10 * DAY,
    expiresAt: null,
    submittedByUserId: "user-1",
    relationship: "none",
    incentivized: false,
    certificationBody: null,
    ...overrides,
  };
}

test("no evidence is Unverified, never Not halal", () => {
  const assessment = deriveHalalAssessment([], NOW);
  assert.equal(assessment.status, "unverified");
  assert.equal(assessment.confidence, "none");
  assert.equal(assessment.evidenceCount, 0);
  assert.equal(assessment.conflict, null);
});

test("a certificate with a named body verifies the branch", () => {
  const assessment = deriveHalalAssessment(
    [
      evidence({
        kind: "certification",
        claimedStatus: "verified",
        certificationBody: "Jamiat Ulama Halal Foundation",
      }),
    ],
    NOW,
  );
  assert.equal(assessment.status, "verified");
  assert.equal(assessment.confidence, "high");
  assert.match(assessment.reasons[0], /Jamiat Ulama Halal Foundation/);
});

test("a certificate with no named body falls back to self declared", () => {
  const assessment = deriveHalalAssessment(
    [evidence({ kind: "certification", claimedStatus: "verified", certificationBody: null })],
    NOW,
  );
  assert.equal(assessment.status, "self-declared");
});

test("two independent contributors are needed for community verified", () => {
  const single = deriveHalalAssessment(
    [
      evidence({ id: "a", submittedByUserId: "user-1" }),
      evidence({ id: "b", submittedByUserId: "user-1" }),
    ],
    NOW,
  );
  assert.equal(single.status, "self-declared");

  const pair = deriveHalalAssessment(
    [
      evidence({ id: "a", submittedByUserId: "user-1" }),
      evidence({ id: "b", submittedByUserId: "user-2" }),
    ],
    NOW,
  );
  assert.equal(pair.status, "community-verified");
  assert.equal(pair.confidence, "medium");
  assert.equal(pair.contributorCount, 2);
});

test("an interested party cannot push a claim past self declared", () => {
  const assessment = deriveHalalAssessment(
    [
      evidence({
        id: "a",
        kind: "certification",
        claimedStatus: "verified",
        certificationBody: "Some Body",
        relationship: "owner",
      }),
      evidence({ id: "b", submittedByUserId: "user-2", incentivized: true }),
    ],
    NOW,
  );
  assert.equal(assessment.status, "self-declared");
  assert.ok(
    assessment.reasons.some((reason) => /interested party/.test(reason)),
    "the cap is explained in the reasons",
  );
});

test("expired evidence stops supporting a status and asks for re-verification", () => {
  const assessment = deriveHalalAssessment(
    [
      evidence({
        kind: "certification",
        claimedStatus: "verified",
        certificationBody: "Some Body",
        capturedAt: NOW - 500 * DAY,
      }),
    ],
    NOW,
  );
  assert.equal(assessment.status, "unverified");
  assert.equal(assessment.staleEvidenceCount, 1);
  assert.equal(assessment.needsReverification, true);
  assert.match(assessment.reasons[0], /expired/);
});

test("contradictory current evidence blocks any confidence badge", () => {
  const assessment = deriveHalalAssessment(
    [
      evidence({ id: "positive", submittedByUserId: "user-1" }),
      evidence({
        id: "negative",
        submittedByUserId: "user-2",
        kind: "menu-photo",
        claimedStatus: "not-halal",
      }),
    ],
    NOW,
  );
  assert.equal(assessment.status, "unverified");
  assert.equal(assessment.confidence, "none");
  assert.deepEqual(assessment.conflict, {
    positiveEvidenceIds: ["positive"],
    negativeEvidenceIds: ["negative"],
  });
});

test("Not halal needs direct evidence and is reported with its strength", () => {
  const documented = deriveHalalAssessment(
    [evidence({ kind: "menu-photo", claimedStatus: "not-halal" })],
    NOW,
  );
  assert.equal(documented.status, "not-halal");
  assert.equal(documented.confidence, "high");

  const singleReport = deriveHalalAssessment(
    [evidence({ kind: "first-hand", claimedStatus: "not-halal" })],
    NOW,
  );
  assert.equal(singleReport.status, "not-halal");
  assert.equal(singleReport.confidence, "medium");
});

test("partial scope lowers verified confidence and is stated", () => {
  const assessment = deriveHalalAssessment(
    [
      evidence({
        kind: "supplier-invoice",
        claimedStatus: "verified",
        scope: "meat-only",
      }),
    ],
    NOW,
  );
  assert.equal(assessment.status, "verified");
  assert.equal(assessment.confidence, "medium");
  assert.equal(assessment.scope, "meat-only");
  assert.ok(assessment.reasons.some((reason) => /part of the menu/.test(reason)));
});

test("halal options is preserved rather than promoted", () => {
  const assessment = deriveHalalAssessment(
    [
      evidence({ id: "a", claimedStatus: "halal-options", submittedByUserId: "user-1" }),
      evidence({ id: "b", claimedStatus: "halal-options", submittedByUserId: "user-2" }),
    ],
    NOW,
  );
  assert.equal(assessment.status, "halal-options");
  assert.equal(assessment.confidence, "medium");
});

test("effective expiry falls back to the per-kind duration", () => {
  const item = evidence({ kind: "certification", capturedAt: NOW, expiresAt: null });
  assert.equal(
    effectiveExpiry(item),
    NOW + DEFAULT_EVIDENCE_TTL_DAYS.certification * DAY,
  );
  assert.equal(effectiveExpiry({ ...item, expiresAt: NOW + DAY }), NOW + DAY);
});

test("one item never supports more than its kind allows", () => {
  assert.equal(
    evidenceSupports(evidence({ kind: "official-website", claimedStatus: "verified" })),
    "self-declared",
  );
  assert.equal(
    evidenceSupports(evidence({ kind: "menu-photo", claimedStatus: "verified" })),
    "community-verified",
  );
});

test("minimum-status thresholds order the taxonomy correctly", () => {
  assert.equal(meetsMinimumStatus("verified", "community-verified"), true);
  assert.equal(meetsMinimumStatus("self-declared", "community-verified"), false);
  assert.equal(meetsMinimumStatus("not-halal", "unverified"), false);
});

test("evidence age reads in plain language", () => {
  assert.equal(formatEvidenceAge(NOW, NOW), "today");
  assert.equal(formatEvidenceAge(NOW - DAY, NOW), "yesterday");
  assert.equal(formatEvidenceAge(NOW - 5 * DAY, NOW), "5 days ago");
  assert.equal(formatEvidenceAge(NOW - 90 * DAY, NOW), "3 months ago");
});
