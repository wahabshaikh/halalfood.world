import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLACE_RATE_LIMITS,
  consumePlaceSubmissionLimits,
  type OtpRateLimitStore,
} from "../src/lib/otp-rate-limit";
import {
  slugifyCity,
  validateGooglePlaceQuery,
  validatePlaceSubmission,
} from "../src/lib/place-submission";

test("city slugs use the existing lowercase kebab-case convention", () => {
  assert.equal(slugifyCity(" São Paulo "), "sao-paulo");
  assert.equal(slugifyCity("New York City"), "new-york-city");
  assert.equal(slugifyCity("東京"), "");
});

test("place validation requires explicit halal confirmation", () => {
  const body = {
    mode: "manual",
    name: "Example Kitchen",
    address: "1 Example Street",
    city: "London",
    halalConfirmed: false,
  };
  const result = validatePlaceSubmission(body);
  assert.deepEqual(result, {
    ok: false,
    error: "You must confirm that this place is halal before submitting.",
  });
});

test("manual validation normalizes fields and allows an optional place id", () => {
  const result = validatePlaceSubmission({
    mode: "manual",
    name: "  Example   Kitchen ",
    address: " 1 Example Street ",
    city: " São Paulo ",
    googlePlaceId: " ChIJmanual ",
    halalConfirmed: true,
  });
  assert.deepEqual(result, {
    ok: true,
    data: {
      mode: "manual",
      name: "Example Kitchen",
      address: "1 Example Street",
      city: "São Paulo",
      citySlug: "sao-paulo",
      googlePlaceId: "ChIJmanual",
      halalConfirmed: true,
    },
  });
});

test("Google validation requires a selected place and bounds search input", () => {
  const missing = validatePlaceSubmission({
    mode: "google",
    name: "Example Kitchen",
    address: "1 Example Street",
    city: "London",
    halalConfirmed: true,
  });
  assert.deepEqual(missing, {
    ok: false,
    error: "Choose a place from Google search first.",
  });
  assert.deepEqual(validateGooglePlaceQuery("a"), {
    ok: false,
    error: "Search must contain 2–120 characters.",
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
