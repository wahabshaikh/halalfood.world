/**
 * Shared cache headers for public documents that crawlers request over and over.
 *
 * D1 counts every row a query examines, and each bot fetch of a place, city,
 * guide, or sitemap used to run the server render again. These responses do
 * not depend on a cookie or on the visitor's location, so one cached copy per
 * URL is safe to share. Workers Cache (`cache.enabled` in wrangler.jsonc)
 * stores them in front of the Worker for the edge lifetime below; browsers
 * always revalidate.
 *
 * Each document also carries `Cache-Tag` values, so a moderator action can
 * purge the place and city it changed (see `listing-cache.ts`) instead of
 * waiting out the lifetime. There used to be a second copy in a named Cache
 * API store inside the Worker. That copy was per colo and could not be purged,
 * so an approved or unpublished place stayed stale there.
 *
 * The homepage, map, search, events, and leaderboard are left uncached:
 * they vary by the eating-city cookie or by a signed-in viewer.
 */

/**
 * Edge lifetimes, sent as `Cloudflare-CDN-Cache-Control`. Workers Cache gives
 * that header precedence and strips it before the response leaves Cloudflare.
 * Workers Cache keys entries by Worker version (wrangler.jsonc does not set
 * `cache.cross_version_cache`), so an edge copy never outlives a deploy.
 */
const DOCUMENT_CACHE_CONTROL =
  "public, max-age=600, s-maxage=600, stale-while-revalidate=86400";
const SITEMAP_CACHE_CONTROL =
  "public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400";
/**
 * What browsers see. With only `s-maxage` and `stale-while-revalidate`, a
 * browser may treat the page as stale-but-usable for a day and show HTML from
 * before a deploy, whose hashed scripts the new version no longer serves.
 * `must-revalidate` turns that off: every document load asks the edge.
 */
export const BROWSER_DOCUMENT_CACHE_CONTROL = "public, max-age=0, must-revalidate";

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

/** Cache-Tag values for a public document path. Workers Cache strips the header. */
export function documentCacheTags(request: Request): string[] {
  const path = new URL(request.url).pathname;
  if (path === "/sitemap.xml" || path.startsWith("/sitemaps/")) return ["sitemaps"];
  if (path === "/cities") return ["cities"];
  if (path === "/guides" || GUIDE_PATH.test(path)) return ["guides"];
  if (PLACE_PATH.test(path)) return ["places", `place-${path.slice("/place/".length).toLowerCase()}`];
  if (CITY_PATH.test(path)) return ["cities", `city-${path.slice("/city/".length)}`];
  return [];
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
 * Mark a successful public document as shareable, with its purge tags.
 * Anything else (errors, cookies, unavailable pages) passes through as is.
 */
export async function withPublicCache(
  request: Request,
  load: () => Promise<Response>,
): Promise<Response> {
  const control = publicCacheControl(request);
  const response = await load();
  if (!control || !isSharedDocument(response)) return response;

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
  headers.set("Cloudflare-CDN-Cache-Control", control);
  headers.set("Cache-Control", BROWSER_DOCUMENT_CACHE_CONTROL);
  const tags = documentCacheTags(request);
  if (tags.length) headers.set("Cache-Tag", tags.join(","));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
