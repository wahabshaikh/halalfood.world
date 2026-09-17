import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFERENCES,
  evaluateSuitability,
  validatePreferences,
  type UserPreferences,
} from "../src/lib/user-preferences";
import { deriveHalalAssessment, type EvidenceRecord } from "../src/lib/halal-taxonomy";
import { emptyFacts, type PlaceFacts } from "../src/lib/place-facts";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const DAY = 86_400_000;
const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function prefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

function facts(overrides: Partial<PlaceFacts> = {}): PlaceFacts {
  return { ...emptyFacts(PLACE_ID), ...overrides };
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "evidence-1",
    kind: "certification",
    claimedStatus: "verified",
    scope: "venue",
    capturedAt: NOW - 10 * DAY,
    expiresAt: null,
    submittedByUserId: "user-1",
    relationship: "none",
    incentivized: false,
    certificationBody: "Some Body",
    ...overrides,
  };
}

test("preferences reject values outside the taxonomy or the allowed ranges", () => {
  assert.equal(validatePreferences({ minimumStatus: "not-halal" }).ok, false);
  assert.equal(validatePreferences({ minimumStatus: "maybe-halal" }).ok, false);
  assert.equal(validatePreferences({ maxEvidenceAgeDays: 0 }).ok, false);
  assert.equal(validatePreferences({ homeCitySlug: "Mumbai City" }).ok, false);
  assert.equal(validatePreferences({ visibilityVisits: "friends" }).ok, false);
});

test("preferences normalise and de-duplicate free-text tags", () => {
  const result = validatePreferences({
    minimumStatus: "verified",
    allergies: ["Peanuts", "peanuts", " Shellfish "],
    cuisines: ["Mughlai"],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.allergies, ["peanuts", "shellfish"]);
  assert.deepEqual(result.data.cuisines, ["mughlai"]);
});

test("a place below the user's minimum status is blocked with a readable reason", () => {
  const assessment = deriveHalalAssessment(
    [evidence({ kind: "official-website", claimedStatus: "self-declared" })],
    NOW,
  );
  const result = evaluateSuitability(
    prefs({ minimumStatus: "verified" }),
    assessment,
    facts(),
    NOW,
  );
  assert.equal(result.meets, false);
  assert.equal(result.blockers[0].code, "below-minimum-status");
  assert.match(result.blockers[0].message, /self declared/i);
});

test("an unknown fact is a warning, never a blocker", () => {
  const assessment = deriveHalalAssessment([evidence()], NOW);
  const result = evaluateSuitability(
    prefs({ minimumStatus: "verified", avoidAlcohol: true }),
    assessment,
    facts({ servesAlcohol: "unknown" }),
    NOW,
  );
  assert.equal(result.meets, true);
  assert.ok(result.warnings.some((note) => note.code === "serves-alcohol-unknown"));
});

test("a known failing fact blocks", () => {
  const assessment = deriveHalalAssessment([evidence()], NOW);
  const result = evaluateSuitability(
    prefs({ minimumStatus: "verified", avoidAlcohol: true }),
    assessment,
    facts({ servesAlcohol: "yes" }),
    NOW,
  );
  assert.equal(result.meets, false);
  assert.equal(result.blockers[0].code, "serves-alcohol");
});

test("a personal evidence-age limit blocks stale but still-valid evidence", () => {
  const assessment = deriveHalalAssessment(
    [evidence({ capturedAt: NOW - 200 * DAY })],
    NOW,
  );
  assert.equal(assessment.status, "verified");
  const result = evaluateSuitability(
    prefs({ minimumStatus: "verified", maxEvidenceAgeDays: 90 }),
    assessment,
    facts(),
    NOW,
  );
  assert.equal(result.meets, false);
  assert.equal(result.blockers[0].code, "evidence-too-old");
});

test("Not halal always blocks, whatever the user's threshold", () => {
  const assessment = deriveHalalAssessment(
    [evidence({ kind: "menu-photo", claimedStatus: "not-halal", certificationBody: null })],
    NOW,
  );
  const result = evaluateSuitability(
    prefs({ minimumStatus: "unverified" }),
    assessment,
    facts(),
    NOW,
  );
  assert.equal(result.meets, false);
  assert.equal(result.blockers[0].code, "not-halal");
});

test("requiring certification blocks a place with no named body", () => {
  const assessment = deriveHalalAssessment([evidence()], NOW);
  assert.equal(
    evaluateSuitability(
      prefs({ minimumStatus: "verified", requireCertification: true }),
      assessment,
      facts({ certificationBody: null }),
      NOW,
    ).meets,
    false,
  );
  assert.equal(
    evaluateSuitability(
      prefs({ minimumStatus: "verified", requireCertification: true }),
      assessment,
      facts({ certificationBody: "Some Body" }),
      NOW,
    ).meets,
    true,
  );
});
