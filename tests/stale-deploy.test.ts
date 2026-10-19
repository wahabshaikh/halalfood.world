/**
 * After a deploy: no browser keeps pre-deploy HTML (public-cache.test.ts), and
 * a tab still running pre-deploy scripts reloads once when a chunk is gone.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "vitest";
import {
  dropDuringStaleChunkReload,
  installStaleChunkReload,
  isStaleChunkReloading,
  resetStaleChunkReload,
  shouldReloadForStaleChunk,
  STALE_CHUNK_RELOAD_KEY,
} from "@/lib/stale-chunk-reload";

function fakeWindow(stored: string | null = null, { storageThrows = false } = {}) {
  const listeners: Record<string, (event: Event) => void> = {};
  const store = new Map<string, string>(stored === null ? [] : [[STALE_CHUNK_RELOAD_KEY, stored]]);
  const win = {
    reloads: 0,
    addEventListener(type: string, listener: (event: Event) => void) {
      listeners[type] = listener;
    },
    sessionStorage: {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("blocked");
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    location: { reload: () => void (win.reloads += 1) },
    fire() {
      let prevented = false;
      listeners["vite:preloadError"]?.({ preventDefault: () => (prevented = true) } as unknown as Event);
      return prevented;
    },
    store,
  };
  return win;
}

beforeEach(() => resetStaleChunkReload());

test("a missing chunk reloads the tab once", () => {
  const win = fakeWindow();
  installStaleChunkReload(win, () => 1_000_000);
  assert.equal(win.fire(), true);
  assert.equal(win.reloads, 1);
  assert.equal(win.store.get(STALE_CHUNK_RELOAD_KEY), "1000000");
});

test("a second failure within a minute surfaces instead of looping", () => {
  const win = fakeWindow("1000000");
  installStaleChunkReload(win, () => 1_030_000);
  assert.equal(win.fire(), false);
  assert.equal(win.reloads, 0);
  assert.equal(shouldReloadForStaleChunk(1_000_000, 1_061_000), true);
});

test("no storage means no reload", () => {
  const win = fakeWindow(null, { storageThrows: true });
  installStaleChunkReload(win, () => 1);
  assert.equal(win.fire(), false);
  assert.equal(win.reloads, 0);
});

test("the client entry installs it", () => {
  const source = readFileSync(new URL("../instrumentation-client.ts", import.meta.url), "utf8");
  assert.match(source, /installStaleChunkReload\(window\)/);
});

// HALALFOOD-WORLD-4: the cancelled preload resolves to undefined, so the client-reference loader throws
// "undefined is not an object (evaluating 'e.ExploreList')" while the reload is already under way.
test("errors raised after the reload starts are not sent to Sentry", () => {
  const win = fakeWindow();
  installStaleChunkReload(win, () => 1_000_000);
  const event = { exception: { values: [{ type: "TypeError", value: "undefined is not an object (evaluating 'e.ExploreList')" }] } };
  assert.equal(dropDuringStaleChunkReload(event), event);
  win.fire();
  assert.equal(isStaleChunkReloading(), true);
  assert.equal(dropDuringStaleChunkReload(event), null);
});

test("a failure that does not reload still reaches Sentry", () => {
  const win = fakeWindow("1000000");
  installStaleChunkReload(win, () => 1_030_000);
  win.fire();
  const event = { message: "Failed to fetch dynamically imported module" };
  assert.equal(dropDuringStaleChunkReload(event), event);
});

test("the client entry drops events during the reload", () => {
  const source = readFileSync(new URL("../instrumentation-client.ts", import.meta.url), "utf8");
  assert.match(source, /beforeSend: dropDuringStaleChunkReload/);
});
