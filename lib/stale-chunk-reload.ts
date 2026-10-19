/**
 * A tab opened before a deploy keeps running the old scripts. The new Worker
 * version serves only its own hashed files, so the old tab's next lazy import
 * 404s and Vite fires `vite:preloadError`. Reload once to pick up the new HTML
 * and scripts. If the same tab hit this less than a minute ago, let the error
 * surface instead, so a genuinely missing file can never cause a reload loop.
 *
 * Cancelling the event (preventDefault) makes Vite's preload helper resolve the
 * import to `undefined` instead of rejecting. The RSC client-reference loader
 * then reads the export off it (`undefined.ExploreList`) and throws a TypeError
 * before the reload navigates away (Sentry HALALFOOD-WORLD-4, and -2 for
 * CityPicker). Those errors are a side effect of the reload we chose, so
 * `isStaleChunkReloading()` lets Sentry's beforeSend drop them.
 */
export const STALE_CHUNK_RELOAD_KEY = "halalfood:stale-chunk-reload";
export const STALE_CHUNK_RELOAD_WINDOW_MS = 60_000;

export function shouldReloadForStaleChunk(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt > STALE_CHUNK_RELOAD_WINDOW_MS;
}

type ReloadWindow = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
  location: { reload(): void };
};

let reloading = false;

/** True once this tab has started a stale-chunk reload: the page is going away. */
export function isStaleChunkReloading(): boolean {
  return reloading;
}

/** Sentry beforeSend: drop events raised while the stale-chunk reload is under way. */
export function dropDuringStaleChunkReload<T>(event: T): T | null {
  return reloading ? null : event;
}

/** Test hook. */
export function resetStaleChunkReload() {
  reloading = false;
}

export function installStaleChunkReload(win: ReloadWindow, now: () => number = Date.now) {
  win.addEventListener("vite:preloadError", (event) => {
    const at = now();
    let last: number | null = null;
    try {
      last = Number(win.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) || null;
      if (!shouldReloadForStaleChunk(last, at)) return;
      win.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(at));
    } catch {
      // Without storage there is no loop guard, so do not reload.
      return;
    }
    reloading = true;
    event.preventDefault();
    win.location.reload();
  });
}
