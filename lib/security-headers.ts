/**
 * Baseline response headers. A strict Content-Security-Policy still needs a nonce
 * pass for MapLibre, Turnstile, Sentry and the JSON-LD scripts, so it is not set here.
 * Existing headers (the photo route's nosniff and CSP) are left as they are.
 */

const BASE: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

/** Copy the response with the headers above. HSTS only on public https hosts. */
export function withSecurityHeaders(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASE)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (request && !headers.has("Strict-Transport-Security")) {
    const url = new URL(request.url);
    const host = url.hostname;
    if (url.protocol === "https:" && host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") {
      headers.set("Strict-Transport-Security", "max-age=15552000");
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}