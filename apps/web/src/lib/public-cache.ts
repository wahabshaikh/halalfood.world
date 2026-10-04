/**
 * Edge cache for public documents that crawlers request over and over.
 *
 * D1 counts every row a query examines. The place table is only about 7.7k
 * rows, but nothing in front of the worker was caching HTML, so each bot
 * fetch of a place, city, guide, or sitemap ran the server render again.
 * A day of that, against a handful of human visitors, is tens of millions of
 * rows. These responses do not depend on a cookie or on the visitor's
 * location, so one cached copy per URL is safe to share.
 *
 * The homepage, map, search, events, and leaderboard are left uncached:
 * they vary by the eating-city cookie or by a signed-in viewer.
 */

const DOCUMENT_CACHE_CONTROL =
  "public, s-maxage=600, stale-while-revalidate=86400";
const SITEMAP_CACHE_CONTROL =
  "public, s-maxage=21600, stale-while-revalidate=86400";

const PLACE_PATH =
  /^\/place\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CITY_PATH = /^\/city\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GUIDE_PATH = /^\/guides\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function publicCacheControl(request: Request): string | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  // Client navigations and prefetches are RSC payloads, not documents.
  // Caching those under the page URL would serve flight data as HTML.
  if (request.headers.get("rsc") === "1") return null;
  if (request.headers.has("next-router-prefetch")) return null;
  if (url.searchParams.has("_rsc")) return null;

  const path = url.pathname;
  if (path === "/sitemap.xml" || path.startsWith("/sitemaps/"))
    return SITEMAP_CACHE_CONTROL;
  if (path === "/cities" || path === "/guides") return DOCUMENT_CACHE_CONTROL;
  if (PLACE_PATH.test(path) || CITY_PATH.test(path) || GUIDE_PATH.test(path))
    return DOCUMENT_CACHE_CONTROL;
  return null;
}

export type ResponseCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

function cacheKey(request: Request): Request {
  return new Request(new URL(request.url).toString(), { method: "GET" });
}

function isSharedDocument(response: Response): boolean {
  if (response.status !== 200) return false;
  if (response.headers.has("set-cookie")) return false;
  // Dynamic app routes often arrive as `no-store` even when the HTML does not
  // depend on the viewer. The paths allowed in `publicCacheControl` are the
  // ones we are willing to share, so that header is replaced rather than obeyed.
  const type = response.headers.get("content-type") ?? "";
  return type.includes("text/html") || type.includes("xml");
}

/**
 * Serve a shared copy of a public document when one is fresh, and store a
 * successful response for the next crawler. Failures fall through to `load`.
 */
export async function withPublicCache(
  request: Request,
  load: () => Promise<Response>,
  cache: ResponseCache | null,
  waitUntil: (promise: Promise<unknown>) => void = () => {},
): Promise<Response> {
  const control = publicCacheControl(request);
  if (!control || !cache) return load();

  const key = cacheKey(request);
  try {
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {
    // A broken cache must not take the page down.
  }

  const response = await load();
  if (!isSharedDocument(response)) return response;

  const type = response.headers.get("content-type") ?? "";
  if (type.includes("html")) {
    let prefix = "";
    try {
      prefix = (await response.clone().text()).slice(0, 12_000);
    } catch {
      return response;
    }
    // Unavailable pages are 200s with noindex. Do not pin an outage.
    if (prefix.includes("noindex")) return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", control);
  const stored = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  waitUntil(
    cache.put(key, stored).catch(() => {
      // Failing to store must not fail the response.
    }),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
