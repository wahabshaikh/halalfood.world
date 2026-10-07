import { expect, test } from "@playwright/test";

// Data-tolerant: runs against local seed data or a deployment (`pnpm e2e:smoke` with PLAYWRIGHT_BASE_URL).

type Place = { id: string; name: string; citySlug: string; lat: number; lng: number };

async function anyPlace(request: import("@playwright/test").APIRequestContext): Promise<Place> {
  const body = (await (await request.get("/api/places?bbox=-180,-90,180,90&limit=1")).json()) as { places: Place[] };
  expect(body.places.length, "expected at least one listed place (run pnpm db:seed:local)").toBeGreaterThan(0);
  return body.places[0]!;
}

test("places API caps the page size, filters by viewport and validates input @smoke", async ({ request }) => {
  const all = (await (await request.get("/api/places?bbox=-180,-90,180,90&limit=99999")).json()) as { places: Place[]; total: number };
  expect(all.total).toBeGreaterThan(0);
  expect(all.places.length).toBeLessThanOrEqual(300);

  const sample = all.places[0]!;
  const box = [sample.lng - 0.1, sample.lat - 0.1, sample.lng + 0.1, sample.lat + 0.1].join(",");
  const local = (await (await request.get(`/api/places?bbox=${box}&limit=3`)).json()) as { places: Place[] };
  expect(local.places.length).toBeGreaterThan(0);
  expect(local.places.length).toBeLessThanOrEqual(3);
  for (const place of local.places) {
    expect(Math.abs(place.lat - sample.lat)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(place.lng - sample.lng)).toBeLessThanOrEqual(0.1);
  }

  expect((await request.get("/api/places?bbox=bad")).status()).toBe(400);
  expect((await request.get("/api/places/not-a-uuid")).status()).toBe(400);
  expect((await request.get("/api/places/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).status()).toBe(404);
  const detail = await request.get(`/api/places/${sample.id}`);
  expect(detail.ok()).toBeTruthy();
});

test("search finds places by name and treats SQL wildcards literally @smoke", async ({ request }) => {
  const sample = await anyPlace(request);
  const word = sample.name.split(" ").find((part) => part.length >= 3) ?? sample.name;
  const found = (await (await request.get(`/api/search?q=${encodeURIComponent(word)}`)).json()) as { places: Place[] };
  expect(found.places.some((place) => place.id === sample.id)).toBe(true);
  const wildcard = (await (await request.get("/api/search?q=%25%25%25")).json()) as { places: Place[] };
  expect(wildcard.places).toEqual([]);
});

test("place and city pages are crawlable @smoke", async ({ request }) => {
  const sample = await anyPlace(request);
  const cityPage = await (await request.get(`/city/${sample.citySlug}`)).text();
  expect(cityPage).toContain("application/ld+json");
  expect(cityPage).toContain("/place/");
  expect(cityPage).not.toContain('content="noindex');

  const placePage = await (await request.get(`/place/${sample.id}`)).text();
  expect(placePage).toContain('"@type":"Restaurant"');
  expect(placePage).toContain('rel="canonical"');

  expect((await request.get("/city/no-such-city-anywhere-at-all")).status()).toBe(404);
  expect((await request.get("/place/not-a-uuid")).status()).toBe(404);
});

test("robots.txt and the sitemap index @smoke", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: https://halalfood.world/sitemap.xml");
  const index = await (await request.get("/sitemap.xml")).text();
  expect(index).toContain("<sitemapindex");
  expect(index).toContain("/sitemaps/places/sitemap/0.xml");
  const places = await (await request.get("/sitemaps/places/sitemap/0.xml")).text();
  expect((places.match(/<loc>/g) ?? []).length).toBeGreaterThan(0);
});
