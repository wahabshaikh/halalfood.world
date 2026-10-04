import assert from "node:assert/strict";
import test from "node:test";
import { checksLoadFailure } from "../src/lib/failure-copy";
import { parseOnboardingDraft } from "../src/lib/onboarding-draft";

test("the halal checks block says what failed and offers a retry", () => {
  const outage = checksLoadFailure(503);
  assert.equal(outage.retry, true);
  assert.match(outage.message, /halal checks/i);
  assert.match(checksLoadFailure(500).message, /server problem/);
  assert.match(checksLoadFailure(429).message, /Too many requests/);
  assert.match(checksLoadFailure(404).message, /no longer listed/);
  assert.equal(checksLoadFailure(401).retry, true);
  assert.notEqual(checksLoadFailure(503).message, checksLoadFailure(404).message);
});

test("an onboarding draft restores the step and answers, never the finished screen", () => {
  const draft = parseOnboardingDraft({
    owner: "user-abc",
    step: "standard",
    displayName: "Amina",
    handle: "amina",
    homeCity: "london",
    standard: { preset: "certified", avoidAlcohol: true, preferHandSlaughter: false },
    standardTouched: true,
    chosen: ["a", 1, "b"],
  });
  assert.deepEqual(draft, {
    owner: "user-abc",
    step: "standard",
    displayName: "Amina",
    handle: "amina",
    homeCity: "london",
    standard: { preset: "certified", avoidAlcohol: true, preferHandSlaughter: false },
    standardTouched: true,
    chosen: ["a", "b"],
  });
  assert.equal(parseOnboardingDraft({ owner: "u", step: "ready" }), null);
  assert.equal(parseOnboardingDraft({ owner: "u", step: "nowhere" }), null);
  assert.equal(parseOnboardingDraft({ step: "profile" }), null, "a draft must name its account");
  assert.equal(parseOnboardingDraft("junk"), null);
  const odd = parseOnboardingDraft({ owner: "u", step: "profile", standard: { preset: "x" } });
  assert.equal(odd?.standard.preset, "community");
  assert.equal(odd?.homeCity, null);
});
