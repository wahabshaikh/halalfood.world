/**
 * Read-through cache for public, visitor-independent query results.
 *
 * D1 bills every row a query scans. The city directory, place counts and
 * sitemap slices have to aggregate the whole `places` table, and they are the
 * same for every visitor, so recomputing them per request spends the daily
 * read budget on identical answers. Results are kept in two layers:
 *
 *   1. isolate memory, which also collapses concurrent identical reads into
 *      one query; and
 *   2. a named Workers cache, shared by isolates in the same colo. It is a
 *      separate namespace from the zone's HTTP cache, so no public URL can
 *      read or poison an entry.
 *
 * Only put data here that is safe to show to anyone: no user ids, no session
 * state, nothing behind a permission check.
 */

type Entry = { expiresAt: number; value: Promise<unknown> };

const memory = new Map<string, Entry>();
const MAX_MEMORY_ENTRIES = 500;
const CACHE_NAME = "halalfood-read-cache";
const CACHE_ORIGIN = "https://read-cache.halalfood.internal/";

type WorkersCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

async function workersCache(): Promise<WorkersCache | null> {
  try {
    const storage = (globalThis as { caches?: { open?: (name: string) => Promise<WorkersCache> } })
      .caches;
    return typeof storage?.open === "function" ? await storage.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

function pruneMemory(now: number) {
  for (const [key, entry] of memory) if (entry.expiresAt <= now) memory.delete(key);
  // Map iteration is insertion order, so this drops the oldest entries first.
  for (const key of memory.keys()) {
    if (memory.size <= MAX_MEMORY_ENTRIES) break;
    memory.delete(key);
  }
}

async function loadThroughEdge<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const cache = await workersCache();
  const request = new Request(CACHE_ORIGIN + encodeURIComponent(key));
  if (cache) {
    try {
      const hit = await cache.match(request);
      if (hit) return (await hit.json()) as T;
    } catch {
      // A cache miss or a corrupt entry just means reading from D1.
    }
  }
  const value = await load();
  if (cache) {
    try {
      await cache.put(
        request,
        Response.json(value, {
          headers: { "Cache-Control": `public, max-age=${ttlSeconds}` },
        }),
      );
    } catch {
      // Failing to cache must never fail the read.
    }
  }
  return value;
}

/**
 * Return a cached value for `key`, loading it at most once per `ttlSeconds`
 * per isolate (and per colo when the Workers cache is available). Failed loads
 * are never cached.
 */
export function cachedRead<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = memory.get(key);
  if (existing && existing.expiresAt > now) return existing.value as Promise<T>;

  pruneMemory(now);
  const value = loadThroughEdge(key, ttlSeconds, load);
  memory.set(key, { expiresAt: now + ttlSeconds * 1000, value });
  value.catch(() => {
    if (memory.get(key)?.value === value) memory.delete(key);
  });
  return value;
}

/** Test hook: forget every in-memory entry. */
export function clearReadCache() {
  memory.clear();
}
