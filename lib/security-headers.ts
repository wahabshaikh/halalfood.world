/**
 * Baseline response headers, plus a nonce Content-Security-Policy on HTML.
 * Photo and avatar responses already send their own CSP and are left as they are.
 * The request policy is set in worker/index.ts so Vinext can stamp the same nonce.
 */
import { contentSecurityPolicy, createNonce, nonceFromPolicy, stampHtmlNonces, upgradeInsecureRequests } from "@/lib/csp";

const BASE: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

type RewriterElement = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
};

type HtmlRewriterInstance = {
  on(selector: string, handlers: { element(element: RewriterElement): void }): HtmlRewriterInstance;
  transform(response: Response): Response;
};

function htmlRewriter(): HtmlRewriterInstance | null {
  const ctor = (globalThis as { HTMLRewriter?: new () => HtmlRewriterInstance }).HTMLRewriter;
  return ctor ? new ctor() : null;
}

function stampElement(nonce: string) {
  return {
    element(element: RewriterElement) {
      if (!element.getAttribute("nonce")) element.setAttribute("nonce", nonce);
    },
  };
}

function stampDocument(response: Response, nonce: string): Response {
  const rewriter = htmlRewriter();
  if (!rewriter) return response;
  return rewriter
    .on("script", stampElement(nonce))
    .on("link", {
      element(element) {
        const rel = (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
        const as = (element.getAttribute("as") ?? "").toLowerCase();
        if (rel.includes("modulepreload") || (rel.includes("preload") && as === "script")) {
          if (!element.getAttribute("nonce")) element.setAttribute("nonce", nonce);
        }
      },
    })
    .transform(response);
}

/** Copy the response with the baseline headers. HTML also gets the nonce policy. */
export async function withSecurityHeaders(response: Response, request?: Request): Promise<Response> {
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
  const type = headers.get("content-type") ?? "";
  const html = type.includes("text/html");
  if (!html || headers.has("Content-Security-Policy")) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const dev = process.env.NODE_ENV !== "production";
  const upgrade = request ? upgradeInsecureRequests(request) : false;
  const nonce = nonceFromPolicy(request?.headers.get("content-security-policy") ?? null) ?? createNonce();
  const policy = contentSecurityPolicy(nonce, { dev, upgradeInsecureRequests: upgrade });
  headers.set("Content-Security-Policy", policy);
  const stamped = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  if (htmlRewriter()) return stampDocument(stamped, nonce);
  const body = stampHtmlNonces(await stamped.text(), nonce);
  return new Response(body, { status: stamped.status, statusText: stamped.statusText, headers });
}
