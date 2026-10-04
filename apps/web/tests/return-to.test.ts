import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { mapReturnPath } from "../src/lib/map-return-path";
import { loginHref, safeReturnPath, signInAgainUrl, signedOutLoginPath } from "../src/lib/signed-out";

function returnToOf(href: string): string | null {
  return new URL(href, "https://halalfood.world").searchParams.get("returnTo");
}

function onPage(path: string, run: () => void) {
  const url = new URL(path, "https://halalfood.world");
  const store = new Map<string, string>();
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    location: { pathname: url.pathname, search: url.search, origin: url.origin },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  };
  try {
    run();
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}

test("safeReturnPath keeps same-origin paths with their query and refuses everything else", () => {
  assert.equal(safeReturnPath("/map?city=london&mine=1"), "/map?city=london&mine=1");
  assert.equal(safeReturnPath("/place/abc?tab=photos#top"), "/place/abc?tab=photos#top");
  for (const bad of [
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    "map",
    "",
    null,
    42,
  ])
    assert.equal(safeReturnPath(bad, "/"), "/", String(bad));
});

test("login links keep the full return URL, safely encoded (QA: city= was dropped)", () => {
  const href = loginHref("/map?city=london&mine=1&whose=friends", "save");
  assert.equal(returnToOf(href), "/map?city=london&mine=1&whose=friends");
  assert.match(href, /returnTo=%2Fmap%3Fcity%3Dlondon%26mine%3D1%26whose%3Dfriends$/);
  assert.equal(new URL(href, "https://x.test").searchParams.get("reason"), "save");
  assert.equal(returnToOf(signedOutLoginPath("//evil.example", false)), "/");
  assert.equal(returnToOf(signedOutLoginPath("/settings", true)), "/settings");
});

test("a bare route keeps the query of the page the browser is on", () => {
  onPage("/place/p1?from=map&city=london", () => {
    assert.equal(returnToOf(signedOutLoginPath("/place/p1", true)), "/place/p1?from=map&city=london");
    assert.equal(returnToOf(loginHref("/place/other")), "/place/other");
  });
});

test("a 401 body's loginUrl is replaced by the page the person is on, reason kept", () => {
  onPage("/map?city=london&mine=1", () => {
    const href = signInAgainUrl({
      loginUrl: "/login?reason=signed-out&returnTo=%2Fmap%3Fbbox%3D1%2C2%2C3%2C4%26limit%3D600",
    });
    assert.equal(returnToOf(href), "/map?city=london&mine=1");
    assert.equal(new URL(href, "https://x.test").searchParams.get("reason"), "signed-out");
    assert.equal(returnToOf(signInAgainUrl({})), "/map?city=london&mine=1");
  });
});

test("the map API's 401 returns to the map page, never its own bbox query", () => {
  const params = new URLSearchParams(
    "bbox=-0.2,51.4,0.1,51.6&limit=600&social=1&mine=1&whose=friends&city=london",
  );
  assert.equal(mapReturnPath(params), "/map?mine=1&whose=friends&city=london");
  params.set("returnTo", "/map?city=london&mine=1&whose=friends&place=abc");
  assert.equal(mapReturnPath(params), "/map?city=london&mine=1&whose=friends&place=abc");
  params.set("returnTo", "https://evil.example/map");
  assert.equal(mapReturnPath(params), "/map?mine=1&whose=friends&city=london");
  params.set("returnTo", "/settings");
  assert.equal(mapReturnPath(params), "/map?mine=1&whose=friends&city=london", "only map pages");
  assert.equal(mapReturnPath(new URLSearchParams("bbox=1,2,3,4&limit=600")), "/map");
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("no login link is built by hand or from an API loginUrl", () => {
  const root = join(import.meta.dirname, "..");
  const offenders: string[] = [];
  for (const file of [...sources(join(root, "app")), ...sources(join(root, "src"))]) {
    const text = readFileSync(file, "utf8");
    if (/\/login\?[^"'`\n]*returnTo=\$\{/.test(text)) offenders.push(`${relative(root, file)}: hand-built returnTo`);
    if (/location(?:\.href\s*=|\.assign\()\s*\w+\.loginUrl/.test(text))
      offenders.push(`${relative(root, file)}: follows the API loginUrl`);
  }
  assert.deepEqual(offenders, []);
});
