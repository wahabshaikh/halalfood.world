import assert from "node:assert/strict";
import test from "node:test";

import { publicCacheControl, withPublicCache, type ResponseCache } from "../src/lib/public-cache";

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
    publicCacheControl(
      request("https://halalfood.world/place/081ea610-a74f-4990-b8ca-3216aac6dfc8"),
    ) ?? "",
    /s-maxage=600/,
  );
  assert.match(
    publicCacheControl(request("https://halalfood.world/city/london?page=2")) ?? "",
    /s-maxage=600/,
  );
  assert.match(
    publicCacheControl(request("https://halalfood.world/guides/mumbai")) ?? "",
    /s-maxage=600/,
  );
  assert.match(
    publicCacheControl(request("https://halalfood.world/cities")) ?? "",
    /s-maxage=600/,
  );
});

test("personalized and non-document requests stay uncached", () => {
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

test("a public HTML response is stored once and reused", async () => {
  const stored = new Map<string, Response>();
  const cache: ResponseCache = {
    async match(key) {
      const hit = stored.get(key.url);
      return hit ? hit.clone() : undefined;
    },
    async put(key, response) {
      stored.set(key.url, response);
    },
  };
  let loads = 0;
  const load = async () => {
    loads += 1;
    return new Response("<html>London</html>", {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  };
  const first = await withPublicCache(
    request("https://halalfood.world/city/london"),
    load,
    cache,
  );
  assert.equal(await first.text(), "<html>London</html>");
  assert.match(first.headers.get("cache-control") ?? "", /s-maxage=600/);
  const second = await withPublicCache(
    request("https://halalfood.world/city/london"),
    load,
    cache,
  );
  assert.equal(await second.text(), "<html>London</html>");
  assert.equal(loads, 1);
});

test("an unavailable noindex page is not stored", async () => {
  const cache: ResponseCache = {
    async match() {
      return undefined;
    },
    async put() {
      throw new Error("should not store");
    },
  };
  const response = await withPublicCache(
    request("https://halalfood.world/city/london"),
    async () =>
      new Response('<html><head><meta name="robots" content="noindex, follow"></head></html>', {
        headers: { "Content-Type": "text/html" },
      }),
    cache,
  );
  assert.match(await response.text(), /noindex/);
});
