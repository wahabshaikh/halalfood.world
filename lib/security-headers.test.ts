import assert from "node:assert/strict";
import { test } from "vitest";
import { withSecurityHeaders } from "./security-headers";

test("security headers are added once and HSTS stays off localhost", () => {
  const local = withSecurityHeaders(new Response("ok"), new Request("http://127.0.0.1:5173/claim"));
  assert.equal(local.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(local.headers.get("X-Frame-Options"), "DENY");
  assert.equal(local.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(local.headers.get("Permissions-Policy") ?? "", /camera=\(\)/);
  assert.equal(local.headers.get("Strict-Transport-Security"), null);

  const live = withSecurityHeaders(
    new Response("ok", { headers: { "X-Content-Type-Options": "nosniff" } }),
    new Request("https://halalfood.world/claim"),
  );
  assert.equal(live.headers.get("Strict-Transport-Security"), "max-age=15552000");
  assert.equal(live.headers.get("X-Frame-Options"), "DENY");
});