import { expect, test } from "./support/test";

// Signed-out journeys. Also runs on the mobile project.

test("explore renders without horizontal overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("explore.png") });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow, "page scrolls sideways").toBe(false);
});

test("search from the header", async ({ page, isMobile }) => {
  test.skip(isMobile, "the header search pill is desktop only");
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search halal places or cities" }).fill("london");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/\/search\?q=london/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("london");
  await expect(page.getByRole("main").getByRole("article").first()).toBeVisible();
});

test("the map draws pins for the area", async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, "phones open the map behind a Show map toggle");
  // London, where seed/places.sql puts three places.
  await page.goto("/map?lat=51.52&lng=-0.1&z=11");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/places? in this area/, {
    timeout: 60_000,
  });
  const map = page.locator(".maplibregl-map");
  expect((await map.boundingBox())?.height, "the map has no height").toBeGreaterThan(300);
  // Pins are buttons named after the place; list tiles only have links.
  await expect(page.getByRole("button", { name: "Seed Grill Whitechapel", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("map.png") });
});

test("clicking a pin opens its place card", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones open the map behind a Show map toggle");
  // Known bug: the pointer lands on the pin on mousedown but on the map canvas
  // on mouseup, so the pin's click never fires. Remove fixme once fixed.
  test.fixme();
  await page.goto("/map?lat=51.52&lng=-0.1&z=11");
  await page.getByRole("button", { name: "Seed Grill Whitechapel", exact: true }).click();
  const card = page.getByRole("region", { name: "Selected place" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toHaveCount(0);
});

test("a place page renders", async ({ page, request }, testInfo) => {
  const response = await request.get("/api/places/search?q=london&limit=1");
  const [place] = (await response.json()).places as { id: string; name: string }[];
  await page.goto(`/place/${place.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(place.name);
  await page.screenshot({ path: testInfo.outputPath("place.png"), fullPage: true });
});

test("signed-out visitors are asked to log in on saved places", async ({ page }) => {
  await page.goto("/saved");
  await expect(page.getByRole("heading", { name: "Keep your favourites close" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" }).first()).toHaveAttribute(
    "href",
    /\/login\?returnTo=%2Fsaved/,
  );
});
