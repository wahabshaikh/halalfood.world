import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLACE_RATE_LIMITS,
  consumePlaceSubmissionLimits,
  type OtpRateLimitStore,
} from "@/lib/otp-rate-limit";
import {
  slugifyCity,
  validateGooglePlaceQuery,
  validatePlaceSubmission,
} from "@/lib/core/place-submission";

test("city slugs use the existing lowercase kebab-case convention", () => {
  assert.equal(slugifyCity(" São Paulo "), "sao-paulo");
  assert.equal(slugifyCity("New York City"), "new-york-city");
  assert.equal(slugifyCity("東京"), "");
});

test("Google validation keeps the place id and the picked name and address", () => {
  const result = validatePlaceSubmission({
    name: "Typed name",
    address: "Typed address",
    city: "Typed city",
    googlePlaceId: " ChIJexample ",
  });
  assert.deepEqual(result, {
    ok: true,
    data: { googlePlaceId: "ChIJexample", name: "Typed name", address: "Typed address", city: "Typed city", answers: null },
  });
});

test("answers become check 1 only when one is definite", () => {
  const answered = validatePlaceSubmission({ googlePlaceId: "ChIJexample", answers: { owned: "yes", pork: "unsure" } });
  assert.ok(answered.ok);
  if (answered.ok) assert.deepEqual(answered.data.answers, { owned: "yes", certified: null, pork: "unsure", alcohol: null });
  const unsure = validatePlaceSubmission({ googlePlaceId: "ChIJexample", answers: { owned: "unsure" } });
  assert.ok(unsure.ok && unsure.data.answers === null);
  assert.equal(validatePlaceSubmission({ googlePlaceId: "ChIJexample", answers: { owned: "maybe" } }).ok, false);
});

test("Google validation requires a selected place and bounds search input", () => {
  const missing = validatePlaceSubmission({});
  assert.deepEqual(missing, {
    ok: false,
    error: "Choose a place from Google search first.",
  });
  assert.deepEqual(validateGooglePlaceQuery("ab"), {
    ok: false,
    error: "Search must contain 3–120 characters.",
  });
  assert.deepEqual(validateGooglePlaceQuery("  ab "), {
    ok: false,
    error: "Search must contain 3–120 characters.",
  });
  assert.deepEqual(validateGooglePlaceQuery("  halal kitchen "), {
    ok: true,
    query: "halal kitchen",
  });
});

test("place submission limiter hashes separate user and IP buckets", async () => {
  let received: Parameters<OtpRateLimitStore["consume"]>[0] | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
  await consumePlaceSubmissionLimits("user-123", "203.0.113.10", store, new Date(0));
  assert.ok(received);
  assert.match(received[0].key, /^place:submit:user:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^place:submit:ip:[0-9a-f]{64}$/);
  assert.equal(received[0].rule.maxCount, PLACE_RATE_LIMITS.submissionUser.maxCount);
  assert.equal(received[1].rule.maxCount, PLACE_RATE_LIMITS.submissionIp.maxCount);
  assert.doesNotMatch(received[0].key, /user-123/);
});
