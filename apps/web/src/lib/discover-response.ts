/**
 * Public `/api/discover` cache policy.
 *
 * The browser may reuse a response for 30 seconds. The edge keeps it for 60.
 * Those are separate headers: putting `max-age` and `s-maxage` in one
 * `Cache-Control` value is rewritten into `CDN-Cache-Control` with `max-age`
 * twice, and the edge then has no single lifetime.
 */
export const DISCOVER_BROWSER_CACHE_CONTROL = "public, max-age=30";
export const DISCOVER_EDGE_CACHE_CONTROL = "public, max-age=60";

export function discoverResponseCacheHeaders(shareable: boolean): Record<string, string> {
  if (!shareable) return { "Cache-Control": "no-store" };
  return {
    "Cache-Control": DISCOVER_BROWSER_CACHE_CONTROL,
    "CDN-Cache-Control": DISCOVER_EDGE_CACHE_CONTROL,
  };
}
