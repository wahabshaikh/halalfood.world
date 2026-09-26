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

  assert.equal(view.label, "Checked by the community");
  assert.match(view.detail, /2 approved checks/);
  assert.match(view.detail, /Latest approved September 17, 2026/);
  assert.match(view.explanation, /a moderator reviewed it/i);
  assert.match(view.explanation, /don’t certify/i);
});

test("uses singular evidence grammar for one approved submission", () => {
  const view = formatHalalStatus({
    status: "evidence-backed",
    approvedCount: 1,
    latestReviewedAt: "2026-09-17T12:34:56.000Z",
  });

  assert.match(view.detail, /1 approved check\./);
  assert.doesNotMatch(view.detail, /checks\./);
});

test("formats unverified copy without treating it as a non-halal determination", () => {
  const status: HalalStatus = {
    status: "unverified",
    approvedCount: 0,
    latestReviewedAt: null,
  };
  const view = formatHalalStatus(status);

  assert.equal(view.label, "Not checked yet");
  assert.match(view.detail, /Nobody has shared a halal check/i);
  assert.match(view.explanation, /doesn’t mean not halal/i);
});

test("formats unavailable copy explicitly instead of downgrading to unverified", () => {
  const view = formatHalalStatus({ status: "unavailable" });

  assert.equal(view.label, "Checks unavailable right now");
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
