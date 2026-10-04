import assert from "node:assert/strict";
import test from "node:test";

import { documentCacheTags, publicCacheControl, withPublicCache } from "../src/lib/public-cache";

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

test("a public HTML response is marked shareable and tagged for purge", async () => {
  let loads = 0;
  const load = async () => {
    loads += 1;
    return new Response("<html>London</html>", {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  };
  const response = await withPublicCache(request("https://halalfood.world/city/london"), load);
  assert.equal(await response.text(), "<html>London</html>");
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=600/);
  assert.equal(response.headers.get("cache-tag"), "cities,city-london");
  assert.equal(loads, 1);

  const place = await withPublicCache(
    request("https://halalfood.world/place/0B210F3A-8f70-47f7-a7d0-e4a46ff55fe2"),
    load,
  );
  assert.equal(
    place.headers.get("cache-tag"),
    "places,place-0b210f3a-8f70-47f7-a7d0-e4a46ff55fe2",
  );
});

test("documentCacheTags names what a listing change purges", () => {
  assert.deepEqual(documentCacheTags(request("https://halalfood.world/cities")), ["cities"]);
  assert.deepEqual(documentCacheTags(request("https://halalfood.world/guides/london")), ["guides"]);
  assert.deepEqual(documentCacheTags(request("https://halalfood.world/sitemaps/places/0.xml")), [
    "sitemaps",
  ]);
  assert.deepEqual(documentCacheTags(request("https://halalfood.world/search?q=x")), []);
});

test("an unavailable noindex page is not marked shareable", async () => {
  const response = await withPublicCache(
    request("https://halalfood.world/city/london"),
    async () =>
      new Response('<html><head><meta name="robots" content="noindex, follow"></head></html>', {
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
      }),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cache-tag"), null);
  assert.match(await response.text(), /noindex/);
});
