import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { checksLoadFailure, placeBlockLoadFailure } from "../src/lib/failure-copy";
import { parseOnboardingDraft } from "../src/lib/onboarding-draft";

test("the halal checks block says what failed and offers a retry", () => {
  const outage = checksLoadFailure(503);
  assert.equal(outage.retry, true);
  assert.match(outage.message, /halal checks/i);
  assert.match(checksLoadFailure(500).message, /server problem/);
  assert.match(checksLoadFailure(429).message, /Too many requests/);
  assert.match(checksLoadFailure(404).message, /no longer listed/);
  assert.notEqual(checksLoadFailure(503).message, checksLoadFailure(404).message);
});

test("401 asks to sign in, 403 says no access, and neither offers Try again", () => {
  const guest = checksLoadFailure(401, false);
  const lost = checksLoadFailure(401, true);
  const denied = checksLoadFailure(403, true);
  assert.equal(guest.retry, false);
  assert.equal(lost.retry, false);
  assert.equal(denied.retry, false);
  assert.equal(guest.signIn, "sign-in");
  assert.equal(lost.signIn, "signed-out");
  assert.equal(denied.signIn, null);
  assert.match(guest.message, /^Sign in to see the halal checks/);
  assert.doesNotMatch(guest.message, /signed out/i);
  assert.match(lost.message, /signed out/);
  assert.match(denied.message, /don't have access/);
  assert.notEqual(guest.message.split(" Reference")[0], denied.message.split(" Reference")[0]);
});

test("photos and reviews blocks get their own copy, a reference and a retry", () => {
  for (const noun of ["photos", "reviews"]) {
    const outage = placeBlockLoadFailure(noun, 503);
    assert.equal(outage.retry, true);
    assert.match(outage.message, new RegExp(`The ${noun} for this place did not load`));
    assert.match(outage.message, /Reference [a-z0-9-]{4,}\./);
    assert.equal(placeBlockLoadFailure(noun, 429).retry, true);
    assert.equal(placeBlockLoadFailure(noun, 404).retry, false);
  }
  for (const file of ["place-photos.tsx", "place-reviews.tsx", "place-halal-verification.tsx"]) {
    const source = readFileSync(new URL(`../app/place/[id]/${file}`, import.meta.url), "utf8");
    assert.match(source, /BlockLoadError/);
    assert.doesNotMatch(source, /could not be loaded\. Please try again/);
  }
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

test("onboarding started from a Save ends back on that place", async () => {
  const { onboardingResumeHref } = await import("../src/lib/onboarding-draft");
  const place = "/place/7c1d2b4e-0000-4000-8000-000000000001";
  assert.equal(onboardingResumeHref(place), place);
  assert.equal(onboardingResumeHref("/u/qa?tab=lists"), "/u/qa?tab=lists");
  assert.equal(onboardingResumeHref("/"), null);
  assert.equal(onboardingResumeHref("/onboarding?returnTo=%2F"), null);
  assert.equal(onboardingResumeHref("/login?reason=save"), null);
  assert.equal(onboardingResumeHref("//evil.example"), null);
  assert.equal(onboardingResumeHref("https://evil.example"), null);
  const flow = readFileSync(new URL("../app/onboarding/onboarding-flow.tsx", import.meta.url), "utf8");
  assert.match(flow, /href=\{resumeHref \?\? mapHref\}>Let me in/);
});
