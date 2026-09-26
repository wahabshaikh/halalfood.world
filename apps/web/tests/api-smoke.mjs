import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
async function get(path, status = 200) {
  const response = await fetch(base + path);
  assert.equal(response.status, status, path);
  return response.json();
}
const all = await get("/api/places?bbox=-180,-90,180,90&limit=99999");
assert.ok(all.total > 0);
assert.ok(all.places.length <= 600);
assert.equal(all.limit, 600);
const local = await get("/api/places?bbox=72.8,19,73,19.2&limit=3");
assert.ok(local.places.length <= 3);
for (const place of local.places) {
  assert.ok(place.lat >= 19 && place.lat <= 19.2);
  assert.ok(place.lng >= 72.8 && place.lng <= 73);
}
const search = await get("/api/places/search?q=mumbai&limit=99999");
assert.ok(search.places.length > 0 && search.places.length <= 40);
assert.equal(search.limit, 40);
const crossing = await get("/api/places?bbox=170,-10,-170,10&limit=5");
for (const place of crossing.places)
  assert.ok(place.lng >= 170 || place.lng <= -170);
await get("/api/places?bbox=bad", 400);
await get("/api/places", 400);
await get("/api/places/search?q=a", 400);
await get("/api/places/search?q=mumbai&limit=-1", 400);
const wildcard = await get("/api/places/search?q=%25%25&limit=1");
assert.equal(wildcard.total, 0, "SQL wildcards must be treated literally");

async function text(path, status = 200) {
  const response = await fetch(base + path);
  assert.equal(response.status, status, path);
  return response.text();
}

// --- lookup endpoints -------------------------------------------------------
const sample = local.places[0] ?? all.places[0];
assert.ok(sample, "expected at least one place with coordinates");
const detail = await get("/api/places/" + sample.id);
assert.equal(detail.id, sample.id);
await get("/api/places/not-a-uuid", 400);
await get("/api/places/3f2504e0-4f89-11d3-9a0c-0305e82c3301", 404);

const city = await get("/api/cities/" + sample.city_slug);
assert.equal(city.city_slug, sample.city_slug);
assert.ok(city.place_count > 0);
await get("/api/cities/Not%20A%20Slug", 400);
await get("/api/cities/no-such-city-anywhere-at-all", 404);

// --- crawlable pages --------------------------------------------------------
const cityPage = await text("/city/" + sample.city_slug);
assert.ok(cityPage.includes("application/ld+json"), "city page needs JSON-LD");
assert.ok(cityPage.includes("ItemList"), "city page needs an ItemList");
assert.ok(
  cityPage.includes("/place/" + sample.id) || cityPage.includes("/place/"),
  "city page must link to place pages",
);
assert.ok(!cityPage.includes("noindex"), "a healthy city page must be indexable");

const placePage = await text("/place/" + sample.id);
assert.ok(placePage.includes('"@type":"Restaurant"'), "place page needs Restaurant JSON-LD");
assert.ok(placePage.includes("approximate"), "place page must keep the pin disclaimer");
assert.ok(placePage.includes('rel="canonical"'), "place page needs a canonical link");

await text("/city/no-such-city-anywhere-at-all", 404);
await text("/place/not-a-uuid", 404);
await text("/cities");

// --- robots and sitemaps ----------------------------------------------------
const robots = await text("/robots.txt");
assert.ok(robots.includes("Sitemap: https://halalfood.world/sitemap.xml"));
assert.ok(robots.includes("Allow: /"));

const index = await text("/sitemap.xml");
assert.ok(index.includes("<sitemapindex"), "/sitemap.xml must be an index");
assert.ok(index.includes("/sitemaps/core/sitemap.xml"));
assert.ok(index.includes("/sitemaps/cities/sitemap.xml"));
assert.ok(
  index.includes("/sitemaps/places/sitemap/0.xml"),
  "the index must advertise at least one place chunk",
);

const citySitemap = await text("/sitemaps/cities/sitemap.xml");
assert.ok((citySitemap.match(/<loc>/g) ?? []).length > 0, "city sitemap is empty");
assert.ok(citySitemap.includes("https://halalfood.world/city/"));

const placeSitemap = await text("/sitemaps/places/sitemap/0.xml");
const placeLocs = (placeSitemap.match(/<loc>/g) ?? []).length;
assert.ok(placeLocs > 0 && placeLocs <= 5000, "place chunk must be non-empty and capped");
assert.ok(placeSitemap.includes("https://halalfood.world/place/"));

console.log(
  "Live API checks passed: viewport coordinates, counts, caps, antimeridian, validation, wildcard escaping,",
  "place/city lookups, crawlable pages, robots.txt and the sitemap index.",
);
