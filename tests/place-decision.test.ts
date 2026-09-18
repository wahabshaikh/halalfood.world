import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidenceLine,
  buildHeadline,
} from "../src/lib/place-decision";
import { deriveHalalAssessment, type EvidenceRecord } from "../src/lib/halal-taxonomy";
import {
  validateVerificationAttributes,
  validateSourceUrl,
} from "../src/lib/halal-verification";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const DAY = 86_400_000;

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "evidence-1",
    kind: "certification",
    claimedStatus: "verified",
    scope: "venue",
    capturedAt: NOW - 30 * DAY,
    expiresAt: null,
    submittedByUserId: "user-1",
    relationship: "none",
    incentivized: false,
    certificationBody: "Some Body",
    ...overrides,
  };
}

test("an empty profile says Unverified is not the same as not halal", () => {
  const headline = buildHeadline(deriveHalalAssessment([], NOW));
  assert.match(headline, /not the same as not halal/i);
});

test("a conflict is stated on the headline, not hidden behind a badge", () => {
  const assessment = deriveHalalAssessment(
    [
      evidence({ id: "a" }),
      evidence({
        id: "b",
        submittedByUserId: "user-2",
        kind: "menu-photo",
        claimedStatus: "not-halal",
        certificationBody: null,
      }),
    ],
    NOW,
  );
  assert.match(buildHeadline(assessment), /conflicts and is under review/);
});

test("the evidence line always carries count, contributors, age and scope", () => {
  const line = buildEvidenceLine(deriveHalalAssessment([evidence()], NOW), NOW);
  assert.match(line, /1 current item/);
  assert.match(line, /1 contributor/);
  assert.match(line, /newest 1 month ago/);
  assert.match(line, /covering the whole venue/);
});

test("expired evidence is named in the evidence line", () => {
  const line = buildEvidenceLine(
    deriveHalalAssessment([evidence({ capturedAt: NOW - 500 * DAY })], NOW),
    NOW,
  );
  assert.match(line, /0 current items/);
});

test("a certificate submission must name its body", () => {
  assert.equal(
    validateVerificationAttributes({ evidenceKind: "certification" }, NOW).ok,
    false,
  );
  assert.equal(
    validateVerificationAttributes(
      { evidenceKind: "certification", certificationBody: "Some Body" },
      NOW,
    ).ok,
    true,
  );
});

test("a narrow scope must say exactly what it covers", () => {
  assert.equal(
    validateVerificationAttributes({ scope: "selected-dishes" }, NOW).ok,
    false,
  );
  assert.equal(
    validateVerificationAttributes(
      { scope: "selected-dishes", scopeNote: "Only the chicken dishes." },
      NOW,
    ).ok,
    true,
  );
});

test("expiry defaults per kind and cannot precede the capture date", () => {
  const result = validateVerificationAttributes(
    { evidenceKind: "first-hand", capturedAt: NOW },
    NOW,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.expiresAt, NOW + 180 * DAY);

  assert.equal(
    validateVerificationAttributes(
      { evidenceKind: "first-hand", capturedAt: NOW, expiresAt: NOW - DAY },
      NOW,
    ).ok,
    false,
  );
});

test("a future or ancient capture date is refused", () => {
  assert.equal(validateVerificationAttributes({ capturedAt: NOW + 10 * DAY }, NOW).ok, false);
  assert.equal(
    validateVerificationAttributes({ capturedAt: NOW - 20 * 365 * DAY }, NOW).ok,
    false,
  );
});

test("an official-website claim must link the page it came from", () => {
  assert.equal(
    validateVerificationAttributes({ evidenceKind: "official-website" }, NOW).ok,
    false,
  );
  assert.equal(
    validateVerificationAttributes(
      { evidenceKind: "official-website", sourceUrl: "https://example.com/halal" },
      NOW,
    ).ok,
    true,
  );
});

test("a source URL must be HTTPS and carry no credentials", () => {
  assert.equal(validateSourceUrl("http://example.com"), null);
  assert.equal(validateSourceUrl("https://user:pass@example.com"), null);
  assert.equal(validateSourceUrl("https://example.com/menu"), "https://example.com/menu");
});

test("an undeclared relationship defaults to none and is still recorded", () => {
  const result = validateVerificationAttributes({}, NOW);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.relationship, "none");
    assert.equal(result.data.incentivized, false);
    assert.equal(result.data.visibility, "public");
  }
});
