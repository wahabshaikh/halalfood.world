/**
 * A tab opened before a deploy keeps running the old scripts. The new Worker
 * version serves only its own hashed files, so the old tab's next lazy import
 * 404s and Vite fires `vite:preloadError`. Reload once to pick up the new HTML
 * and scripts. If the same tab hit this less than a minute ago, let the error
 * surface instead, so a genuinely missing file can never cause a reload loop.
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
    event.preventDefault();
    win.location.reload();
  });
}
