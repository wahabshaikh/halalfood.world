/**
 * AC-48 on 4e59dc2: after a real 401 on /map?city=london&mine=1&whose=friends
 * the toast had no Sign in, the URL lost whose=friends, the menu's "Log in or
 * sign up" had no returnTo, and the all-fail box's Sign in dropped whose=.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDiscoveryFilters, serializeDiscoveryFilters } from "@halalfood/core/discovery-filters";
import { filtersForUrl, unauthorizedFallback } from "../src/lib/map-loading";
import { menuLoginHref, signInAgainUrl, signedOutLoginPath, currentReturnPath } from "../src/lib/signed-out";

const PAGE = "/map?city=london&mine=1&whose=friends";

function onPage(path: string, run: () => void) {
  const url = new URL(path, "https://halalfood.world");
  const previous = (globalThis as { window?: unknown }).window;
  const location = { pathname: url.pathname, search: url.search };
  (globalThis as { window?: unknown }).window = {
    location,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  try {
    run();
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}

const returnTo = (href: string) => new URL(href, "https://x.test").searchParams.get("returnTo");

/** What the map's URL sync writes, given the filters in use and the ones asked for. */
function urlAfter(page: string, filters: ReturnType<typeof parseDiscoveryFilters>, requested: typeof filters | null) {
  const url = new URL(page, "https://halalfood.world");
  const next = new URLSearchParams(serializeDiscoveryFilters(filtersForUrl(filters, requested)));
  for (const key of ["whose", "mine"]) url.searchParams.delete(key);
  for (const [key, value] of next) url.searchParams.set(key, value);
  return url.pathname + url.search;
}

test("the 401 fallback loads everyone but the address keeps whose=friends", () => {
  const asked = parseDiscoveryFilters(new URL(PAGE, "https://x.test").searchParams);
  assert.equal(asked.whose, "friends");
  const fallback = unauthorizedFallback({ filters: asked, signedIn: false });
  assert.equal(fallback.personal, true);
  assert.equal(fallback.filters.whose, "everyone");
  const kept = urlAfter(PAGE, fallback.filters, asked);
  assert.match(kept, /whose=friends/);
  assert.match(kept, /city=london/);
  // Without the record of what was asked, it would drop: the QA finding.
  assert.doesNotMatch(urlAfter(PAGE, fallback.filters, null), /whose=friends/);
});

test("every sign-in link on that page returns to the friends map", () => {
  onPage(PAGE, () => {
    const server401 = {
      error: "Sign in to see your places and your friends’ places.",
      loginUrl: "/login?reason=sign-in&returnTo=%2Fmap%3Fcity%3Dlondon%26mine%3D1%26whose%3Dfriends",
    };
    // (a) the toast, from the 401 answer; it is the same URL as the page's.
    assert.equal(returnTo(signInAgainUrl(server401)), PAGE);
    assert.equal(returnTo(server401.loginUrl), currentReturnPath());
    // (c) the menu.
    const menu = menuLoginHref();
    assert.equal(returnTo(menu), PAGE);
    assert.equal(new URL(menu, "https://x.test").searchParams.get("reason"), "join");
    // (d) the all-fail box.
    assert.equal(returnTo(signedOutLoginPath(currentReturnPath(), false)), PAGE);
  });
});

test("the menu never returns to login or onboarding", () => {
  onPage("/login?reason=join&returnTo=%2Fmap", () => assert.equal(returnTo(menuLoginHref()), "/"));
  onPage("/onboarding?ref=abc", () => assert.equal(returnTo(menuLoginHref()), "/"));
  onPage("/place/p1?from=map", () => assert.equal(returnTo(menuLoginHref()), "/place/p1?from=map"));
});

test("the map wires it up: toast link, kept scope, menu read on the tap", () => {
  const map = readFileSync(new URL("../app/map/map-view.tsx", import.meta.url), "utf8");
  assert.match(map, /filtersForUrl\(filters, requestedFilters\)/);
  assert.match(map, /setRequestedFilters\(\(current\) => current \?\? filters\)/);
  assert.match(map, /notice === SCOPE_FALLBACK_NOTICE && \(/);
  assert.match(map, /window\.location\.assign\(signInAgainUrl\(fallback401\)\)/);
  const menu = readFileSync(new URL("../src/components/account-menu.tsx", import.meta.url), "utf8");
  assert.match(menu, /event\.currentTarget\.href = menuLoginHref\(\)/);
  assert.doesNotMatch(menu, /href="\/login\?reason=join"/);
});

test("the fallback toast hides while the all-fail error box is up (no overlap at 390)", async () => {
  const { mapNoticeVisible, SCOPE_FALLBACK_NOTICE } = await import("../src/lib/map-loading");
  const failure = { message: "Sign in to open places on the map.", signIn: true };
  assert.equal(mapNoticeVisible({ notice: SCOPE_FALLBACK_NOTICE, error: null, viewportTooWide: false }), true);
  assert.equal(mapNoticeVisible({ notice: SCOPE_FALLBACK_NOTICE, error: failure, viewportTooWide: false }), false);
  assert.equal(mapNoticeVisible({ notice: SCOPE_FALLBACK_NOTICE, error: null, viewportTooWide: true }), false);
  assert.equal(mapNoticeVisible({ notice: "", error: null, viewportTooWide: false }), false);
  const view = readFileSync(new URL("../app/map/map-view.tsx", import.meta.url), "utf8");
  assert.match(view, /mapNoticeVisible\(\{ notice, error, viewportTooWide \}\) && \(/);
  assert.doesNotMatch(view, /\) : \(\s*notice && \(/);
});

test("the toast's Sign in link is at least a 44x44 px tap target", async () => {
  const { TOAST_LINK_TAP_TARGET } = await import("../src/lib/map-loading");
  assert.match(TOAST_LINK_TAP_TARGET, /\bmin-h-11\b/);
  assert.match(TOAST_LINK_TAP_TARGET, /\bmin-w-11\b/);
  const view = readFileSync(new URL("../app/map/map-view.tsx", import.meta.url), "utf8");
  assert.match(view, /className=\{TOAST_LINK_TAP_TARGET\}/);
});
