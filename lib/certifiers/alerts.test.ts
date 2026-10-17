import { test } from "vitest";
import assert from "node:assert/strict";
import { CERT_ALERT_RATE_LIMITS, consumeCertAlertSignupLimits, type OtpRateLimitStore } from "@/lib/otp-rate-limit";
import { parseAlertSignup } from "./alerts";

test("a sign-up is normalised: lowercased email, all countries by default, scopes in vocabulary order", () => {
  const parsed = parseAlertSignup({ email: " A@Example.COM ", certifiers: ["anic-halal-authority", "anic-halal-authority"], scopes: ["cosmetics", "food"], turnstileToken: "t" });
  assert.deepEqual(parsed, {
    ok: true,
    value: { email: "a@example.com", filter: { authorities: ["bpjph"], certifiers: ["anic-halal-authority"], scopes: ["food", "cosmetics"] }, turnstileToken: "t" },
  });
});

test("bad input gets one plain sentence", () => {
  assert.deepEqual(parseAlertSignup(null), { ok: false, error: "Send a valid JSON object." });
  assert.deepEqual(parseAlertSignup([]), { ok: false, error: "Send a valid JSON object." });
  assert.equal(parseAlertSignup({ email: "a@example.com", authorities: "bpjph", turnstileToken: "t" }).ok, false);
  assert.equal(parseAlertSignup({ email: "a@example.com", certifiers: ["Not A Slug!"], turnstileToken: "t" }).ok, false);
  assert.equal(parseAlertSignup({ email: "a@example.com", certifiers: Array.from({ length: 21 }, (_, i) => `c-${i}`), turnstileToken: "t" }).ok, false);
  assert.equal(parseAlertSignup({ email: "a@example.com", scopes: [1], turnstileToken: "t" }).ok, false);
});

test("the sign-up budget is per hashed email and per hashed IP", async () => {
  let received: Parameters<OtpRateLimitStore["consume"]>[0] | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
  await consumeCertAlertSignupLimits("a@example.com", "203.0.113.10", store, new Date(0));
  assert.match(received![0].key, /^cert-alert:signup:email:[0-9a-f]{64}$/);
  assert.match(received![1].key, /^cert-alert:signup:ip:[0-9a-f]{64}$/);
  assert.equal(received![0].rule, CERT_ALERT_RATE_LIMITS.signupEmail);
  assert.equal(received![1].rule, CERT_ALERT_RATE_LIMITS.signupIp);
});
