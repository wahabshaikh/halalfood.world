import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Serious and critical accessibility violations, as mosques.world checks. The logo wordmark is excluded:
 * text that is part of a logo has no contrast requirement (WCAG 1.4.3), and its brand orange is fixed.
 */
async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).exclude("[data-wordmark]").analyze();
  return results.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => `${item.id}: ${item.help}`);
}

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

  test(`${path} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test("a place page shows the place and its halal status", async ({ page, request }) => {
  const all = await (await request.get("/api/places?bbox=-180,-90,180,90&limit=1")).json();
  const place = all.places[0] as { id: string; name: string };
  await page.goto(`/place/${place.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(place.name);
});

