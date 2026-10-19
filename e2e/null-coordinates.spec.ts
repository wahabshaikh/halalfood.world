import { expect, test } from "@playwright/test";

// A place listed without coordinates (seed/local.sql), as Halal Food Scout stores one it couldn't geocode with
// confidence. Not @smoke: production has no seed.
const PENDING = "00000000-0000-4000-8000-000000000009";
const NAME = "Seed Pending Pin Cafe";

test("a place without coordinates renders, says its location is pending and skips Nearby", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.goto(`/place/${PENDING}`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
  await expect(page.getByText("Location pending: this place isn’t on the map yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Directions" }).first()).toHaveAttribute("href", /destination=Seed%20Pending%20Pin%20Cafe/);
  // Nearby needs this place's own coordinates; the seed's London places would otherwise show there.
  await expect(page.getByRole("region", { name: "Nearby" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a place without coordinates is on its city page and in search, but not on the map", async ({ page, request }) => {
  expect((await page.goto("/city/london?filters="))?.status()).toBe(200);
  await expect(page.locator(`main a[href='/place/${PENDING}']`).first()).toBeVisible();

  const search = await (await request.get("/api/search?q=pending%20pin")).json();
  expect(search.places.map((place: { id: string }) => place.id)).toContain(PENDING);
  const near = await (await request.get("/api/places?city=london&near=51.5175,-0.064&limit=100")).json();
  const listed = near.places.find((place: { id: string }) => place.id === PENDING);
  expect(listed).toMatchObject({ lat: null, lng: null, distanceKm: null });
  const map = await (await request.get("/api/places?bbox=-0.2,51.4,0.1,51.6&limit=300")).json();
  expect(map.places.map((place: { id: string }) => place.id)).not.toContain(PENDING);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.goto("/map?city=london"))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
