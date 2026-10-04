import { safeReturnPath } from "./signed-out";

/** Query keys that only describe the API request, never the page. */
const REQUEST_ONLY_PARAMS = ["bbox", "limit", "social", "returnTo", "lat", "lng"];

/**
 * Where a sign-in from this 401 should come back to: the map page the person
 * was on, as the client reports it (`returnTo`, same-origin `/map…` only), or
 * else the map with the page-level filters and city from this query. Never the
 * API's own bbox and limit.
 */
export function mapReturnPath(params: URLSearchParams): string {
  const reported = safeReturnPath(params.get("returnTo"), "");
  if (/^\/map(?:[?#]|$)/.test(reported)) return reported;
  const page = new URLSearchParams(params);
  for (const key of REQUEST_ONLY_PARAMS) page.delete(key);
  const query = page.toString();
  return query ? `/map?${query}` : "/map";
}
