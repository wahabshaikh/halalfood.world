import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Places from the halalfoodnear.me import (seed/local.sql, migrations/0007_place_provenance.sql). The Diner has no
// evidence it exists, so it is labelled "Unverified" and noindexed; the Grill has a sourced Scout certified claim, so
// it is verified and indexable. Not @smoke: production has no seed.
const UNVERIFIED = "00000000-0000-4000-8000-000000000010";
const VERIFIED = "00000000-0000-4000-8000-000000000011";
const EXPLAINER = "Imported from a public directory and not yet checked by our community or a certifier.";

async function seriousViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).exclude("[data-wordmark]").analyze();
  return results.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => `${item.id}: ${item.help}`);
}

test("an unverified imported place says so with the explainer, and is noindexed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(`/place/${UNVERIFIED}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const notice = page.getByRole("region", { name: "Unverified" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(EXPLAINER);
  // Provenance never changes the halal status copy.
  await expect(page.getByRole("region", { name: "Halal status" })).toContainText("Not checked yet");
  const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(jsonLd).toContain("Unverified");
  expect(await seriousViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a verified imported place has no label and stays indexable", async ({ page }) => {
  const response = await page.goto(`/place/${VERIFIED}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBeUndefined();
  await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("region", { name: "Unverified" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seed Imported Grill");
});

test("list cards show the Unverified chip only on the unverified place", async ({ page }) => {
  expect((await page.goto("/city/london?filters="))?.status()).toBe(200);
  const card = page.locator("li").filter({ has: page.locator(`a[href='/place/${UNVERIFIED}']`) });
  const chip = card.getByTestId("unverified-chip");
  await expect(chip).toHaveText("Unverified");
  await expect(chip).toHaveAttribute("title", EXPLAINER);
  const verified = page.locator("li").filter({ has: page.locator(`a[href='/place/${VERIFIED}']`) });
  await expect(verified).toBeVisible();
  await expect(verified.getByTestId("unverified-chip")).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
});

test("the map's selected-place card shows the chip", async ({ page }) => {
  expect((await page.goto(`/map?place=${UNVERIFIED}`))?.status()).toBe(200);
  const selected = page.getByRole("region", { name: "Selected place" });
  await expect(selected).toContainText("Seed Imported Diner", { timeout: 20_000 });
  await expect(selected.getByTestId("unverified-chip")).toHaveText("Unverified");
});

test("the place API says which places are unverified", async ({ request }) => {
  const one = await (await request.get(`/api/places/${UNVERIFIED}`)).json();
  expect(one.place).toMatchObject({ id: UNVERIFIED, unverified: true });
  const list = await (await request.get("/api/places?city=london&limit=100")).json();
  const flags = Object.fromEntries(list.places.map((place: { id: string; unverified: boolean }) => [place.id, place.unverified]));
  expect(flags[UNVERIFIED]).toBe(true);
  expect(flags[VERIFIED]).toBe(false);
});

test("the sitemap leaves unverified imports out and keeps verified ones", async ({ request }) => {
  const index = await (await request.get("/sitemap.xml")).text();
  const chunks = [...index.matchAll(/<loc>[^<]*(\/sitemaps\/places\/sitemap\/\d+\.xml)<\/loc>/g)].map((match) => match[1]);
  expect(chunks.length).toBeGreaterThan(0);
  const urls = (await Promise.all(chunks.map(async (path) => (await request.get(path)).text()))).join("\n");
  expect(urls).toContain(`/place/${VERIFIED}`);
  expect(urls).not.toContain(`/place/${UNVERIFIED}`);
});
