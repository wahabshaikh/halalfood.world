import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { documentCacheTags, publicCacheControl, withPublicCache } from "./public-cache";

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

test("public documents get a shared cache lifetime", () => {
  assert.match(
    publicCacheControl(request("https://halalfood.world/sitemap.xml")) ?? "",
    /s-maxage=21600/,
  );
  assert.match(
    publicCacheControl(request("https://halalfood.world/sitemaps/places/sitemap/0.xml")) ?? "",
    /s-maxage=21600/,
  );
  assert.match(
    publicCacheControl(request("https://halalfood.world/cities")) ?? "",
    /s-maxage=600/,
  );
});

test("personalized and non-document requests stay uncached", () => {
  // These render the signed-in viewer's saves and friends on the server.
  assert.equal(publicCacheControl(request("https://halalfood.world/place/081ea610-a74f-4990-b8ca-3216aac6dfc8")), null);
  assert.equal(publicCacheControl(request("https://halalfood.world/city/london")), null);
  assert.equal(publicCacheControl(request("https://halalfood.world/list/081ea610-a74f-4990-b8ca-3216aac6dfc8")), null);
  assert.equal(publicCacheControl(request("https://halalfood.world/")), null);
  assert.equal(publicCacheControl(request("https://halalfood.world/map")), null);
  assert.equal(publicCacheControl(request("https://halalfood.world/search?q=london")), null);
  assert.equal(publicCacheControl(request("https://halalfood.world/api/discover")), null);
  assert.equal(
    publicCacheControl(
      request("https://halalfood.world/place/081ea610-a74f-4990-b8ca-3216aac6dfc8/check"),
    ),
    null,
  );
  assert.equal(
    publicCacheControl(
      request("https://halalfood.world/place/081ea610-a74f-4990-b8ca-3216aac6dfc8", {
        rsc: "1",
      }),
    ),
    null,
  );
  assert.equal(
    publicCacheControl(
      request("https://halalfood.world/city/london?_rsc=abc"),
    ),
    null,
  );
});

test("a public HTML response is marked shareable and tagged for purge", async () => {
  let loads = 0;
  const load = async () => {
    loads += 1;
    return new Response("<html>London</html>", {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  };
  const response = await withPublicCache(request("https://halalfood.world/cities"), load);
  assert.equal(await response.text(), "<html>London</html>");
  // The edge keeps it for 10 minutes; browsers always ask again, so a deploy
  // never leaves a browser holding pre-deploy HTML.
  assert.match(response.headers.get("cloudflare-cdn-cache-control") ?? "", /max-age=600/);
  assert.match(response.headers.get("cloudflare-cdn-cache-control") ?? "", /stale-while-revalidate=86400/);
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.doesNotMatch(response.headers.get("cache-control") ?? "", /stale-while-revalidate|s-maxage/);
  assert.equal(response.headers.get("cache-tag"), "cities");
  assert.equal(loads, 1);
});

test("documentCacheTags names what a listing change purges", () => {
  assert.deepEqual(documentCacheTags(request("https://halalfood.world/cities")), ["cities"]);
  assert.deepEqual(documentCacheTags(request("https://halalfood.world/place/081ea610-a74f-4990-b8ca-3216aac6dfc8")), []);
  assert.deepEqual(documentCacheTags(request("https://halalfood.world/sitemaps/places/0.xml")), [
    "sitemaps",
  ]);
  assert.deepEqual(documentCacheTags(request("https://halalfood.world/search?q=x")), []);
});

test("an unavailable noindex page is not marked shareable", async () => {
  const response = await withPublicCache(
    request("https://halalfood.world/cities"),
    async () =>
      new Response('<html><head><meta name="robots" content="noindex, follow"></head></html>', {
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
      }),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), null);
  assert.equal(response.headers.get("cache-tag"), null);
  assert.match(await response.text(), /noindex/);
});

test("edge copies are per Worker version, so a deploy starts from an empty cache", () => {
  // Workers Cache puts the version in the key unless cross_version_cache is on.
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"cache":\s*\{\s*"enabled":\s*true\s*\}/);
  assert.doesNotMatch(config, /cross_version_cache/);
});
