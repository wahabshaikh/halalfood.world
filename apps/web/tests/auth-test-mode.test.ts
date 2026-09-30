import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  isAuthTestModeEnabled,
  isTestEmail,
  usesTestSignIn,
} from "../src/lib/auth-test-mode";
import { POST as authPost } from "../app/api/auth/[...all]/route";

const originalEnvironment = {
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
};

afterEach(() => {
  const environment = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
});

test("test sign-in is on for local servers and pull request previews", () => {
  assert.equal(isAuthTestModeEnabled("http://localhost:3000"), true);
  assert.equal(isAuthTestModeEnabled("http://127.0.0.1:8787"), true);
  assert.equal(
    isAuthTestModeEnabled("https://pr-49-halalfood-world.wahabshaikh.workers.dev"),
    true,
  );
});

test("test sign-in is off for production and anything unrecognised", () => {
  for (const url of [
    "https://halalfood.world",
    "https://www.halalfood.world",
    "https://halalfood-world.wahabshaikh.workers.dev",
    "http://pr-49-halalfood-world.wahabshaikh.workers.dev",
    "https://pr-49-halalfood-world.wahabshaikh.workers.dev.evil.com",
    "https://localhost.evil.com",
    "",
    "not a url",
  ]) {
    assert.equal(isAuthTestModeEnabled(url), false, url);
  }
});

test("only example.com addresses are test addresses", () => {
  assert.equal(isTestEmail("e2e-1@example.com"), true);
  assert.equal(isTestEmail(" Person@EXAMPLE.com "), true);
  assert.equal(isTestEmail("person@example.com.evil.com"), false);
  assert.equal(isTestEmail("person@notexample.com"), false);
  assert.equal(isTestEmail("example.com"), false);
  assert.equal(isTestEmail(undefined), false);
  assert.equal(
    usesTestSignIn("person@example.com", "https://halalfood.world"),
    false,
  );
});

test("production still requires the bot check for test addresses", async () => {
  process.env.BETTER_AUTH_URL = "https://halalfood.world";
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  const response = await authPost(
    new Request("https://halalfood.world/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "e2e@example.com", type: "sign-in" }),
    }),
  );
  // Turnstile is not configured, so the request stops before Better Auth.
  assert.equal(response.status, 503);
});
