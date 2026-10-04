import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  SESSION_COOKIE_CACHE_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "../src/lib/session-lifetime";
import { clearFormDraft, readFormDraft, saveFormDraft } from "../src/lib/form-draft";
import { SIGNED_OUT_COPY, signedOutLoginPath } from "../src/lib/signed-out";

test("sessions last 30 days and roll forward daily", () => {
  assert.equal(SESSION_EXPIRES_IN_SECONDS, 60 * 60 * 24 * 30);
  assert.equal(SESSION_UPDATE_AGE_SECONDS, 60 * 60 * 24);
  assert.ok(SESSION_UPDATE_AGE_SECONDS < SESSION_EXPIRES_IN_SECONDS);
  assert.equal(SESSION_COOKIE_CACHE_SECONDS, 5 * 60);
  assert.ok(SESSION_COOKIE_CACHE_SECONDS < 60 * 60);

  const auth = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /expiresIn: SESSION_EXPIRES_IN_SECONDS/);
  assert.match(auth, /updateAge: SESSION_UPDATE_AGE_SECONDS/);
  assert.match(auth, /maxAge: SESSION_COOKIE_CACHE_SECONDS/);
});

test("a 401 sends people back to the page they were on", () => {
  assert.equal(SIGNED_OUT_COPY, "You've been signed out. Sign in again.");
  assert.equal(
    signedOutLoginPath("/place/abc/check"),
    "/login?reason=signed-out&returnTo=%2Fplace%2Fabc%2Fcheck",
  );
  assert.equal(signedOutLoginPath("https://evil.example/phish"), "/login?reason=signed-out&returnTo=%2F");
  assert.equal(signedOutLoginPath("//evil.example"), "/login?reason=signed-out&returnTo=%2F");

  const login = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(login, /reason === "signed-out"/);
  assert.match(login, /SIGNED_OUT_COPY/);
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

  const checkIn = readFileSync(new URL("../app/place/[id]/place-check-in.tsx", import.meta.url), "utf8");
  const review = readFileSync(new URL("../app/place/[id]/place-reviews.tsx", import.meta.url), "utf8");
  const check = readFileSync(new URL("../app/place/[id]/check/check-flow.tsx", import.meta.url), "utf8");
  const add = readFileSync(new URL("../app/add/add-place-form.tsx", import.meta.url), "utf8");
  for (const source of [checkIn, review, check, add]) {
    assert.match(source, /signedOutLoginPath/);
    assert.match(source, /saveFormDraft|saveDraft\(/);
  }
  assert.match(checkIn, /useState\(false\)/);
});
