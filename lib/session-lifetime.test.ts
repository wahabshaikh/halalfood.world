import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  SESSION_COOKIE_CACHE_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./session-lifetime";
import { clearFormDraft, readFormDraft, saveFormDraft } from "./form-draft";
import { SIGNED_OUT_COPY, hasSessionCookie, signInCopyFor, signedOutLoginPath } from "./signed-out";

test("sessions last 30 days and roll forward daily", () => {
  assert.equal(SESSION_EXPIRES_IN_SECONDS, 60 * 60 * 24 * 30);
  assert.equal(SESSION_UPDATE_AGE_SECONDS, 60 * 60 * 24);
  assert.ok(SESSION_UPDATE_AGE_SECONDS < SESSION_EXPIRES_IN_SECONDS);
  assert.equal(SESSION_COOKIE_CACHE_SECONDS, 5 * 60);
  assert.ok(SESSION_COOKIE_CACHE_SECONDS < 60 * 60);

  const auth = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  assert.match(auth, /expiresIn: SESSION_EXPIRES_IN_SECONDS/);
  assert.match(auth, /updateAge: SESSION_UPDATE_AGE_SECONDS/);
  assert.match(auth, /maxAge: SESSION_COOKIE_CACHE_SECONDS/);
});

test("a 401 sends people back to the page they were on", () => {
  assert.equal(SIGNED_OUT_COPY, "You've been signed out. Sign in again.");
  assert.equal(
    signedOutLoginPath("/place/abc/check", true),
    "/login?reason=signed-out&returnTo=%2Fplace%2Fabc%2Fcheck",
  );
  assert.equal(signedOutLoginPath("https://evil.example/phish", true), "/login?reason=signed-out&returnTo=%2F");
  assert.equal(signedOutLoginPath("//evil.example", false), "/login?reason=sign-in&returnTo=%2F");

  const login = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(login, /reason === "signed-out"/);
  assert.match(login, /SIGNED_OUT_COPY/);
  assert.match(login, /signInCopyFor\(returnTo\)/);
});

test("someone who was never signed in is asked to sign in, not told they were signed out", () => {
  // No browser storage here, so the default is "never signed in".
  assert.equal(signedOutLoginPath("/add"), "/login?reason=sign-in&returnTo=%2Fadd");
  assert.equal(signInCopyFor("/add"), "Sign in to add a place.");
  assert.equal(signInCopyFor("/feed"), "Sign in to continue.");
  const withCookie = new Request("https://halalfood.world/api/x", {
    headers: { cookie: "a=1; __Secure-better-auth.session_token=abc.def" },
  });
  const plain = new Request("https://halalfood.world/api/x", { headers: { cookie: "hf_eating_city=london" } });
  assert.equal(hasSessionCookie(withCookie), true);
  assert.equal(hasSessionCookie(plain), false);
  assert.equal(hasSessionCookie(new Request("https://halalfood.world/api/x")), false);
});

test("form drafts round-trip in session storage", () => {
  const saved = new Map<string, string>();
  const store = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
    removeItem: (key: string) => {
      saved.delete(key);
    },
  };
  saveFormDraft("halalfood:review-draft:1", { title: "Lamb", body: "Worth it", editing: true }, store);
  assert.deepEqual(readFormDraft("halalfood:review-draft:1", store), {
    title: "Lamb",
    body: "Worth it",
    editing: true,
  });
  clearFormDraft("halalfood:review-draft:1", store);
  assert.equal(readFormDraft("halalfood:review-draft:1", store), null);

  const check = readFileSync(new URL("../app/place/[id]/check/check-form.tsx", import.meta.url), "utf8");
  assert.match(check, /saveFormDraft/);
  assert.match(check, /clearFormDraft/);
});
