/**
 * Nonce Content-Security-Policy for HTML documents.
 *
 * Vinext reads `Content-Security-Policy` on the incoming request and puts that
 * nonce on its bootstrap scripts (lib is applied in worker/index.ts before
 * render). The same policy is set on the response. Script hosts are a fallback
 * for browsers without `'strict-dynamic'`; current browsers trust the nonce
 * and scripts it loads (Turnstile, the analytics bundle).
 *
 * `navigate-to` is intentionally unset so a paid claim can send the browser to
 * Whop checkout. `WHOP_OWNER_PLAN_ID` still has to be set before that URL exists.
 */

export type CspOptions = {
  /** Vite's dev client needs eval and a websocket. Production builds leave this off. */
  dev?: boolean;
  /** Public https only. Upgrading localhost breaks the dev server. */
  upgradeInsecureRequests?: boolean;
};

const SCRIPT_HOSTS = ["https://challenges.cloudflare.com"];
const CONNECT_HOSTS = [
  "https://datafa.st",
  "https://basemaps.cartocdn.com",
  "https://tiles.basemaps.cartocdn.com",
  "https://*.basemaps.cartocdn.com",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.sentry.io",
  "https://challenges.cloudflare.com",
];

/** 16 random bytes, standard base64, safe inside a CSP nonce and an HTML attribute. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** True for public https hosts. Local and plain http stay on the scheme they used. */
export function upgradeInsecureRequests(request: Request): boolean {
  const url = new URL(request.url);
  const host = url.hostname;
  return url.protocol === "https:" && host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]";
}

/** One line. Vinext splits on `;` and reads the first `'nonce-…'` in `script-src`. */
export function contentSecurityPolicy(nonce: string, options: CspOptions = {}): string {
  const script = [
    "script-src",
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    options.dev ? "'unsafe-eval'" : "",
    ...SCRIPT_HOSTS,
  ].filter(Boolean);
  const connect = ["connect-src", "'self'", ...CONNECT_HOSTS, ...(options.dev ? ["ws:", "wss:", "http://127.0.0.1:*", "http://localhost:*"] : [])];
  const directives = [
    "default-src 'self'",
    script.join(" "),
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    connect.join(" "),
    "worker-src 'self' blob:",
    "frame-src https://challenges.cloudflare.com https://whop.com https://*.whop.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://whop.com https://*.whop.com",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    options.upgradeInsecureRequests ? "upgrade-insecure-requests" : "",
  ].filter(Boolean);
  return directives.join("; ");
}

/** Nonce vinext already used, if this request was stamped before render. */
export function nonceFromPolicy(policy: string | null): string | null {
  if (!policy) return null;
  const script = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src "));
  if (!script) return null;
  const source = script.split(/\s+/).find((part) => part.startsWith("'nonce-") && part.endsWith("'") && part.length > 8);
  return source ? source.slice(7, -1) : null;
}

/**
 * Copy the request and set the policy Vinext reads while rendering.
 * `cf` is not part of the Fetch spec, so it is copied across for the visitor-location proxy.
 */
export function requestWithContentSecurityPolicy(request: Request): Request {
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV !== "production",
    upgradeInsecureRequests: upgradeInsecureRequests(request),
  });
  const headers = new Headers(request.headers);
  headers.delete("content-security-policy-report-only");
  headers.set("content-security-policy", policy);
  const next = new Request(request, { headers });
  const cf = Reflect.get(request, "cf");
  if (cf !== undefined) {
    try {
      Object.defineProperty(next, "cf", { value: cf, configurable: true });
    } catch {
      // The runtime already exposes cf on the clone.
    }
  }
  return next;
}

/** Add a nonce to parser-inserted scripts and script preloads that do not have one yet. */
export function stampHtmlNonces(html: string, nonce: string): string {
  const safe = nonce.replace(/["&<>]/g, "");
  const withNonce = (tag: string, attrs: string) => (/\snonce\s*=/i.test(attrs) ? `<${tag}${attrs}>` : `<${tag}${attrs} nonce="${safe}">`);
  return html
    .replace(/<script\b([^>]*)>/gi, (_match, attrs: string) => withNonce("script", attrs))
    .replace(/<link\b([^>]*)>/gi, (match, attrs: string) => {
      const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
      const as = /\bas\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
      const tokens = rel.split(/\s+/);
      if (tokens.includes("modulepreload") || (tokens.includes("preload") && as === "script")) return withNonce("link", attrs);
      return match;
    });
}
