import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeOtpRequestLimits,
  evaluateOtpRateLimit,
  getClientIp,
  normalizeEmail,
  OTP_RATE_LIMITS,
  retryAfterSeconds,
  consumeOtpVerificationLimits,
  type OtpRateLimitRule,
  type OtpRateLimitState,
  type OtpRateLimitStore,
} from "../src/lib/otp-rate-limit";
import { verifyTurnstile } from "../src/lib/turnstile";
import { POST as authPost } from "../app/api/auth/[...all]/route";

const environmentKeys = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NODE_ENV",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);

function setEnvironment(
  values: Partial<Record<(typeof environmentKeys)[number], string | undefined>>,
) {
  const environment = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
}

afterEach(() => {
  const environment = process.env as Record<string, string | undefined>;
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
});

test("OTP limiter allows the first send and enforces cooldown and daily cap", () => {
  const rule = OTP_RATE_LIMITS.requestEmail;
  const first = evaluateOtpRateLimit(
    { windowStartedAt: null, count: 0, lastActionAt: null },
    rule,
    0,
  );
  assert.equal(first.allowed, true);
  assert.deepEqual(first.next, {
    windowStartedAt: 0,
    count: 1,
    lastActionAt: 0,
  });

  const cooldown = evaluateOtpRateLimit(first.next, rule, 30_000);
  assert.equal(cooldown.allowed, false);
  assert.equal(cooldown.retryAfterMs, 30_000);

  let state: OtpRateLimitState = first.next;
  for (let count = 2; count <= rule.maxCount; count++) {
    const decision = evaluateOtpRateLimit(
      state,
      rule,
      count * rule.cooldownMs,
    );
    assert.equal(decision.allowed, true);
    state = decision.next;
  }
  const dailyCap = evaluateOtpRateLimit(
    state,
    rule,
    rule.windowMs - 1,
  );
  assert.equal(dailyCap.allowed, false);
  assert.equal(dailyCap.retryAfterMs, 1);

  const reset = evaluateOtpRateLimit(state, rule, rule.windowMs);
  assert.equal(reset.allowed, true);
  assert.equal(reset.next.count, 1);
});

test("verification limiter locks after the configured attempt budget", () => {
  const rule = OTP_RATE_LIMITS.verifyEmail;
  let state: OtpRateLimitState = {
    windowStartedAt: null,
    count: 0,
    lastActionAt: null,
  };

  for (let count = 0; count < rule.maxCount; count++) {
    const decision = evaluateOtpRateLimit(state, rule, count * 1_000);
    assert.equal(decision.allowed, true);
    state = decision.next;
  }

  const locked = evaluateOtpRateLimit(state, rule, 5_000);
  assert.equal(locked.allowed, false);
  assert.equal(locked.retryAfterMs, rule.windowMs - 5_000);
});

test("email identifiers are normalized before rate-limit keying", () => {
  assert.equal(normalizeEmail("  Person@Example.COM "), "person@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail("a".repeat(321) + "@example.com"), null);
  assert.equal(retryAfterSeconds(1001), 2);
});

test("request limiter passes hashed email and IP buckets to the rate-limit store", async () => {
  let received:
    | readonly [
        { key: string; rule: OtpRateLimitRule },
        { key: string; rule: OtpRateLimitRule },
      ]
    | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };

  await consumeOtpRequestLimits(
    "person@example.com",
    "203.0.113.20",
    store,
    new Date(0),
  );
  assert.ok(received);
  assert.match(received[0].key, /^request:email:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^request:ip:[0-9a-f]{64}$/);
  assert.doesNotMatch(received[0].key, /person|example/i);
  assert.equal(received[0].rule.maxCount, 5);
  assert.equal(received[1].rule.maxCount, 30);
});

test("production IP limiting only trusts Cloudflare's connecting IP", () => {
  setEnvironment({ NODE_ENV: "production" });
  const request = new Request("https://halalfood.world/api/auth/sign-in/email-otp", {
    headers: {
      "x-forwarded-for": "198.51.100.9",
      "cf-connecting-ip": "203.0.113.8",
    },
  });
  assert.equal(getClientIp(request), "203.0.113.8");
  const noCfRequest = new Request(request.url, {
    headers: { "x-forwarded-for": "198.51.100.9" },
  });
  assert.equal(getClientIp(noCfRequest), "unknown");
});

test("Turnstile validation fails closed when either key is missing", async () => {
  setEnvironment({ TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: "secret" });
  let called = false;
  const result = await verifyTurnstile(
    new Request("https://halalfood.world/login"),
    "token",
    async () => {
      called = true;
      return new Response();
    },
  );
  assert.deepEqual(result, { ok: false, reason: "missing-config" });
  assert.equal(called, false);
});

test("Turnstile validation posts the server secret and accepts success", async () => {
  setEnvironment({
    TURNSTILE_SITE_KEY: "public-site-key",
    TURNSTILE_SECRET_KEY: "server-secret",
  });
  let requestBody: URLSearchParams | undefined;
  const result = await verifyTurnstile(
    new Request("https://halalfood.world/login", {
      headers: { "cf-connecting-ip": "203.0.113.8" },
    }),
    "turnstile-token",
    async (input, init) => {
      assert.equal(input, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      requestBody = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({ success: true }));
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(requestBody?.get("secret"), "server-secret");
  assert.equal(requestBody?.get("response"), "turnstile-token");
  assert.equal(requestBody?.get("remoteip"), "203.0.113.8");
});

test("auth OTP requests reject missing Turnstile configuration before Better Auth", async () => {
  setEnvironment({
    TURNSTILE_SITE_KEY: undefined,
    TURNSTILE_SECRET_KEY: undefined,
  });
  const response = await authPost(
    new Request("https://halalfood.world/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.8",
        "x-turnstile-token": "token",
      },
      body: JSON.stringify({ email: "person@example.com", type: "sign-in" }),
    }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Sign-in is temporarily unavailable. Please try again.",
  });
});
