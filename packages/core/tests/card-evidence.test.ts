import assert from "node:assert/strict";
import { test } from "node:test";
import { cardEvidenceLine } from "../src/card-evidence";

const NOW = Date.UTC(2026, 9, 4);

test("an unverified card names the gap and does not call the place not halal", () => {
  const line = cardEvidenceLine({ status: "unverified", latestEvidenceAt: null, now: NOW });
  assert.equal(line.line, "Unverified · no dated evidence");
  assert.equal(line.source, "Community evidence");
  assert.equal(line.line.includes("Not halal"), false);
  assert.equal(line.line.toLowerCase().includes("certified"), false);
});

test("dated evidence is distinguishable from an unverified card", () => {
  const verified = cardEvidenceLine({
    status: "verified",
    latestEvidenceAt: NOW - 10 * 24 * 60 * 60 * 1000,
    now: NOW,
  });
  const unverified = cardEvidenceLine({ status: "unverified", now: NOW });
  assert.equal(verified.line, "Verified halal · evidence 10 days ago");
  assert.equal(verified.source, "Community evidence");
  assert.notEqual(verified.line, unverified.line);
  assert.equal(verified.line.includes("Google"), false);
});
