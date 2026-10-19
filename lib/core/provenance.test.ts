import assert from "node:assert/strict";
import { test } from "vitest";
import {
  HALALFOODNEARME_IMPORT,
  IMPORT_SOURCES,
  isHalalfoodnearmeImport,
  isUnverifiedImport,
  nextImportVerifiedAt,
  seenToExist,
  type ExistenceEvidence,
} from "./provenance";

const NONE: ExistenceEvidence = { eligibleChecks: 0, approvedDocuments: 0, creatorVerifications: 0, sourcedCertifiedClaims: 0 };

test("the import is the exact bulk-insert millisecond with no submitter", () => {
  assert.equal(HALALFOODNEARME_IMPORT.createdAt, Date.parse("2026-09-13T06:58:19.475Z"));
  assert.ok(IMPORT_SOURCES.includes(HALALFOODNEARME_IMPORT.source));
  assert.equal(isHalalfoodnearmeImport({ createdAt: 1789282699475, submittedByUserId: null }), true);
  assert.equal(isHalalfoodnearmeImport({ createdAt: 1789282699474, submittedByUserId: null }), false);
  assert.equal(isHalalfoodnearmeImport({ createdAt: 1789282699476, submittedByUserId: null }), false);
  assert.equal(isHalalfoodnearmeImport({ createdAt: 1789282699475, submittedByUserId: "user-1" }), false);
  // Slam Burger Luton, the one carried place that was not scraped.
  assert.equal(isHalalfoodnearmeImport({ createdAt: 1790281853240, submittedByUserId: null }), false);
});

test("no evidence leaves an imported place unverified", () => {
  assert.equal(seenToExist(NONE), false);
});

test("any one kind of evidence verifies it exists", () => {
  assert.equal(seenToExist({ ...NONE, eligibleChecks: 1 }), true);
  assert.equal(seenToExist({ ...NONE, approvedDocuments: 1 }), true);
  assert.equal(seenToExist({ ...NONE, creatorVerifications: 1 }), true);
  assert.equal(seenToExist({ ...NONE, sourcedCertifiedClaims: 1 }), true);
  assert.equal(seenToExist({ eligibleChecks: 3, approvedDocuments: 1, creatorVerifications: 2, sourcedCertifiedClaims: 1 }), true);
});

test("verification keeps its first time and reverts when the evidence goes", () => {
  assert.equal(nextImportVerifiedAt(null, true, 500), 500);
  assert.equal(nextImportVerifiedAt(100, true, 500), 100);
  assert.equal(nextImportVerifiedAt(100, false, 500), null);
  assert.equal(nextImportVerifiedAt(null, false, 500), null);
});

test("only imported places that are not verified carry the label", () => {
  assert.equal(isUnverifiedImport({ importSource: "halalfoodnear.me", importVerifiedAt: null }), true);
  assert.equal(isUnverifiedImport({ importSource: "halalfoodnear.me", importVerifiedAt: 1 }), false);
  assert.equal(isUnverifiedImport({ importSource: null, importVerifiedAt: null }), false);
});
