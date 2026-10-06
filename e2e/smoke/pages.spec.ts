import { expect, test } from "@playwright/test";

const pages = ["/", "/cities", "/map", "/search?q=seed", "/community", "/events", "/login"];

for (const path of pages) {
  test(`${path} renders without errors or horizontal overflow @smoke`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `${path} scrolls sideways`).toBe(false);
    expect(errors, `${path} threw in the browser`).toEqual([]);
  });
}

test("a place page shows the place and its halal status", async ({ page, request }) => {
  const all = await (await request.get("/api/places?bbox=-180,-90,180,90&limit=1")).json();
  const place = all.places[0] as { id: string; name: string };
  await page.goto(`/place/${place.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(place.name);
});

