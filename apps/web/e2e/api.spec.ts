import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./support/test";

// Read-only API, page and sitemap contracts. Runs against the seeded local
// database (seed/places.sql) or any deployment with data.

async function json(request: APIRequestContext, path: string, status = 200) {
  const response = await request.get(path);
  expect(response.status(), path).toBe(status);
  return response.json();
}

async function text(request: APIRequestContext, path: string, status = 200) {
  const response = await request.get(path);
  expect(response.status(), path).toBe(status);
  return response.text();
}

test("place viewport, search and validation", async ({ request }) => {
  const all = await json(request, "/api/places?bbox=-180,-90,180,90&limit=99999");
  expect(all.total).toBeGreaterThan(0);
  expect(all.places.length).toBeLessThanOrEqual(600);
  expect(all.limit).toBe(600);

  const local = await json(request, "/api/places?bbox=72.8,19,73,19.2&limit=3");
  expect(local.places.length).toBeLessThanOrEqual(3);
  for (const place of local.places) {
    expect(place.lat).toBeGreaterThanOrEqual(19);
    expect(place.lat).toBeLessThanOrEqual(19.2);
    expect(place.lng).toBeGreaterThanOrEqual(72.8);
    expect(place.lng).toBeLessThanOrEqual(73);
  }

  const search = await json(request, "/api/places/search?q=mumbai&limit=99999");
  expect(search.places.length).toBeGreaterThan(0);
  expect(search.places.length).toBeLessThanOrEqual(40);
  expect(search.limit).toBe(40);

  const crossing = await json(request, "/api/places?bbox=170,-10,-170,10&limit=5");
  for (const place of crossing.places)
    expect(place.lng >= 170 || place.lng <= -170).toBe(true);

  await json(request, "/api/places?bbox=bad", 400);
  await json(request, "/api/places", 400);
  await json(request, "/api/places/search?q=a", 400);
  await json(request, "/api/places/search?q=mumbai&limit=-1", 400);
  const wildcard = await json(request, "/api/places/search?q=%25%25&limit=1");
  expect(wildcard.total, "SQL wildcards must be treated literally").toBe(0);
});

test("place and city lookups and crawlable pages", async ({ request }) => {
  const local = await json(request, "/api/places?bbox=72.8,19,73,19.2&limit=3");
  const all = await json(request, "/api/places?bbox=-180,-90,180,90&limit=1");
  const sample = local.places[0] ?? all.places[0];
  expect(sample, "expected at least one place with coordinates").toBeTruthy();

  const detail = await json(request, "/api/places/" + sample.id);
  expect(detail.id).toBe(sample.id);
  await json(request, "/api/places/not-a-uuid", 400);
  await json(request, "/api/places/3f2504e0-4f89-11d3-9a0c-0305e82c3301", 404);

  const city = await json(request, "/api/cities/" + sample.city_slug);
  expect(city.city_slug).toBe(sample.city_slug);
  expect(city.place_count).toBeGreaterThan(0);
  await json(request, "/api/cities/Not%20A%20Slug", 400);
  await json(request, "/api/cities/no-such-city-anywhere-at-all", 404);

  const cityPage = await text(request, "/city/" + sample.city_slug);
  expect(cityPage, "city page needs JSON-LD").toContain("application/ld+json");
  expect(cityPage, "city page needs an ItemList").toContain("ItemList");
  expect(cityPage, "city page must link to place pages").toContain("/place/");
  expect(cityPage, "a healthy city page must be indexable").not.toContain("noindex");

  const placePage = await text(request, "/place/" + sample.id);
  expect(placePage, "place page needs Restaurant JSON-LD").toContain('"@type":"Restaurant"');
  expect(placePage, "place page must keep the pin disclaimer").toContain("approximate");
  expect(placePage, "place page needs a canonical link").toContain('rel="canonical"');

  await text(request, "/city/no-such-city-anywhere-at-all", 404);
  await text(request, "/place/not-a-uuid", 404);
  await text(request, "/cities");
});

test("robots.txt and the sitemap index", async ({ request }) => {
  const robots = await text(request, "/robots.txt");
  expect(robots).toContain("Sitemap: https://halalfood.world/sitemap.xml");
  expect(robots).toContain("Allow: /");

  const index = await text(request, "/sitemap.xml");
  expect(index, "/sitemap.xml must be an index").toContain("<sitemapindex");
  expect(index).toContain("/sitemaps/core/sitemap.xml");
  expect(index).toContain("/sitemaps/cities/sitemap.xml");
  expect(index, "the index must advertise at least one place chunk").toContain(
    "/sitemaps/places/sitemap/0.xml",
  );

  const citySitemap = await text(request, "/sitemaps/cities/sitemap.xml");
  expect((citySitemap.match(/<loc>/g) ?? []).length, "city sitemap is empty").toBeGreaterThan(0);
  expect(citySitemap).toContain("https://halalfood.world/city/");

  const placeSitemap = await text(request, "/sitemaps/places/sitemap/0.xml");
  const placeLocs = (placeSitemap.match(/<loc>/g) ?? []).length;
  expect(placeLocs, "place chunk must be non-empty and capped").toBeGreaterThan(0);
  expect(placeLocs).toBeLessThanOrEqual(5000);
  expect(placeSitemap).toContain("https://halalfood.world/place/");
});
