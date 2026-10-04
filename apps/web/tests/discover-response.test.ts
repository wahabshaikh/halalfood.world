import assert from "node:assert/strict";
import test from "node:test";

import { discoverResponseCacheHeaders } from "../src/lib/discover-response";

test("a public discover response has one max-age on each cache header", () => {
  const headers = discoverResponseCacheHeaders(true);
  assert.equal(headers["Cache-Control"], "public, max-age=30");
  assert.equal(headers["CDN-Cache-Control"], "public, max-age=60");
  assert.equal(headers["CDN-Cache-Control"].match(/max-age=/g)?.length, 1);
  assert.equal(headers["Cache-Control"].includes("s-maxage"), false);
  assert.equal(headers["CDN-Cache-Control"].includes("s-maxage"), false);
});

test("a signed-in discover response is not stored", () => {
  assert.deepEqual(discoverResponseCacheHeaders(false), { "Cache-Control": "no-store" });
});
