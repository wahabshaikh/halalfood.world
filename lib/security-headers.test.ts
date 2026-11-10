import assert from "node:assert/strict";
import { test } from "vitest";
import { contentSecurityPolicy, createNonce, nonceFromPolicy, requestWithContentSecurityPolicy, stampHtmlNonces, upgradeInsecureRequests } from "./csp";
import { withSecurityHeaders } from "./security-headers";

function directive(policy: string, name: string): string {
  return policy.split(";").map((part) => part.trim()).find((part) => part === name || part.startsWith(`${name} `)) ?? "";
}

test("security headers are added once and HSTS stays off localhost", async () => {
  const local = await withSecurityHeaders(new Response("ok"), new Request("http://127.0.0.1:5173/claim"));
  assert.equal(local.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(local.headers.get("X-Frame-Options"), "DENY");
  assert.equal(local.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(local.headers.get("Permissions-Policy") ?? "", /camera=\(\)/);
  assert.equal(local.headers.get("Strict-Transport-Security"), null);
  assert.equal(local.headers.get("Content-Security-Policy"), null);

  const live = await withSecurityHeaders(
    new Response("ok", { headers: { "X-Content-Type-Options": "nosniff" } }),
    new Request("https://halalfood.world/claim"),
  );
  assert.equal(live.headers.get("Strict-Transport-Security"), "max-age=15552000");
  assert.equal(live.headers.get("X-Frame-Options"), "DENY");
});

test("the page policy is nonce based and does not allow inline scripts", () => {
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce, { dev: false, upgradeInsecureRequests: true });
  assert.equal(nonceFromPolicy(policy), nonce);
  const script = directive(policy, "script-src");
  assert.match(script, /'strict-dynamic'/);
  assert.match(script, new RegExp(`'nonce-${nonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.equal(script.includes("'unsafe-inline'"), false);
  assert.equal(script.includes("'unsafe-eval'"), false);
  assert.match(script, /https:\/\/challenges\.cloudflare\.com/);
  assert.match(directive(policy, "connect-src"), /https:\/\/datafa\.st/);
  assert.match(directive(policy, "connect-src"), /tiles\.basemaps\.cartocdn\.com/);
  assert.match(directive(policy, "connect-src"), /ingest\.us\.sentry\.io/);
  assert.match(directive(policy, "frame-src"), /https:\/\/whop\.com/);
  assert.match(directive(policy, "form-action"), /https:\/\/\*\.whop\.com/);
  assert.equal(directive(policy, "object-src"), "object-src 'none'");
  assert.equal(directive(policy, "base-uri"), "base-uri 'self'");
  assert.equal(directive(policy, "frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(directive(policy, "script-src-attr"), "script-src-attr 'none'");
  assert.match(directive(policy, "style-src"), /'unsafe-inline'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.equal(policy.includes("navigate-to"), false);

  const dev = contentSecurityPolicy(nonce, { dev: true, upgradeInsecureRequests: false });
  assert.match(directive(dev, "script-src"), /'unsafe-eval'/);
  assert.match(directive(dev, "connect-src"), /ws:/);
  assert.equal(dev.includes("upgrade-insecure-requests"), false);
  assert.equal(upgradeInsecureRequests(new Request("http://127.0.0.1:5173/")), false);
  assert.equal(upgradeInsecureRequests(new Request("https://halalfood.world/")), true);
  assert.equal(nonceFromPolicy(null), null);
  assert.equal(nonceFromPolicy("default-src 'self'"), null);
});

test("html responses carry the request nonce and script tags receive it", async () => {
  const stamped = requestWithContentSecurityPolicy(new Request("https://halalfood.world/place/1"));
  const nonce = nonceFromPolicy(stamped.headers.get("content-security-policy"));
  assert.ok(nonce);
  const cf = { city: "London" };
  Object.defineProperty(stamped, "cf", { value: cf });
  const again = requestWithContentSecurityPolicy(stamped);
  assert.equal(Reflect.get(again, "cf"), cf);
  assert.notEqual(nonceFromPolicy(again.headers.get("content-security-policy")), nonce);

  const html = `<!doctype html><html><head><link rel="modulepreload" href="/app.js"><link rel="stylesheet" href="/app.css"></head><body><script src="/a.js"></script><script nonce="keep">1</script><script type="application/ld+json">{}</script></body></html>`;
  const response = await withSecurityHeaders(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }), stamped);
  const policy = response.headers.get("Content-Security-Policy") ?? "";
  assert.equal(nonceFromPolicy(policy), nonce);
  assert.equal(directive(policy, "script-src").includes("'unsafe-inline'"), false);
  const body = await response.text();
  assert.ok(body.includes(`<script src="/a.js" nonce="${nonce}"></script>`));
  assert.match(body, /<script nonce="keep">1<\/script>/);
  assert.ok(body.includes(`<script type="application/ld+json" nonce="${nonce}">`));
  assert.ok(body.includes(`<link rel="modulepreload" href="/app.js" nonce="${nonce}">`));
  assert.match(body, /<link rel="stylesheet" href="\/app\.css">/);
  assert.equal(stampHtmlNonces(`<script src="/a.js"></script>`, nonce).includes(nonce), true);

  const kept = await withSecurityHeaders(
    new Response("gif", { headers: { "content-type": "image/gif", "content-security-policy": "default-src 'none'" } }),
    new Request("https://halalfood.world/api/photos/x"),
  );
  assert.equal(kept.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(kept.headers.get("X-Frame-Options"), "DENY");
});

test("HTMLRewriter stamps scripts when the runtime provides one", async () => {
  const previous = (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter;
  const seen: string[] = [];
  class HTMLRewriter {
    on(selector: string, handlers: { element(element: { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void }): void }) {
      seen.push(selector);
      if (selector === "script") {
        const attrs: Record<string, string> = {};
        handlers.element({
          getAttribute: (name) => attrs[name] ?? null,
          setAttribute: (name, value) => {
            attrs[name] = value;
          },
        });
        assert.match(attrs.nonce ?? "", /.+/)
      }
      return this;
    }
    transform(response: Response) {
      return new Response("rewritten", { status: response.status, headers: response.headers });
    }
  }
  (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = HTMLRewriter;
  try {
    const response = await withSecurityHeaders(
      new Response("<script src=\"/a.js\"></script>", { headers: { "content-type": "text/html" } }),
      new Request("https://halalfood.world/"),
    );
    assert.equal(await response.text(), "rewritten");
    assert.ok(seen.includes("script"));
    assert.ok(seen.includes("link"));
    assert.match(response.headers.get("Content-Security-Policy") ?? "", /'strict-dynamic'/);
  } finally {
    if (previous) (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = previous;
    else delete (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter;
  }
});
