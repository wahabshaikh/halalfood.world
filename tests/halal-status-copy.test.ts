import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatHalalStatus,
  parseHalalStatus,
  type HalalStatus,
} from "../src/lib/halal-status-view";

test("formats evidence-backed copy with count, reviewed date, and certification caveat", () => {
  const view = formatHalalStatus({
    status: "evidence-backed",
    approvedCount: 2,
    latestReviewedAt: "2026-09-17T12:34:56.000Z",
  });

  assert.equal(view.label, "Evidence-backed");
  assert.match(view.detail, /2 approved community evidence submissions/);
  assert.match(view.detail, /Latest reviewed September 17, 2026/);
  assert.match(view.explanation, /community-submitted evidence reviewed by moderators/i);
  assert.match(view.explanation, /not formal certification/i);
});

test("uses singular evidence grammar for one approved submission", () => {
  const view = formatHalalStatus({
    status: "evidence-backed",
    approvedCount: 1,
    latestReviewedAt: "2026-09-17T12:34:56.000Z",
  });

  assert.match(view.detail, /1 approved community evidence submission\./);
  assert.doesNotMatch(view.detail, /submissions\./);
});

test("formats unverified copy without treating it as a non-halal determination", () => {
  const status: HalalStatus = {
    status: "unverified",
    approvedCount: 0,
    latestReviewedAt: null,
  };
  const view = formatHalalStatus(status);

  assert.equal(view.label, "Unverified");
  assert.match(view.detail, /No halal evidence has been reviewed yet/i);
  assert.match(view.explanation, /does not mean non-halal/i);
});

test("formats unavailable copy explicitly instead of downgrading to unverified", () => {
  const view = formatHalalStatus({ status: "unavailable" });

  assert.equal(view.label, "Evidence status unavailable");
  assert.doesNotMatch(view.detail, /unverified/i);
  assert.doesNotMatch(view.explanation, /unverified/i);
});

test("fails closed when an evidence-backed API summary lacks a valid reviewed date", () => {
  for (const summary of [
    { status: "evidence-backed", approvedCount: 1 },
    { status: "evidence-backed", approvedCount: 1, latestReviewedAt: null },
    { status: "evidence-backed", approvedCount: 1, latestReviewedAt: "not a date" },
  ]) {
    assert.deepEqual(
      parseHalalStatus(summary),
      { status: "unavailable" },
    );
  }
});
