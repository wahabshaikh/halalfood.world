import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

await mkdir(".test-artifacts", { recursive: true });
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

// Explore
await page.goto(base);
await page.waitForSelector(".explore-hero h1");
await page.screenshot({ path: ".test-artifacts/explore-desktop.png" });
console.log("Explore rows:", await page.locator(".place-row").count());

// Search from the header pill
await page.getByRole("searchbox", { name: "Search halal places or cities" }).fill("london");
await page.getByRole("button", { name: "Search", exact: true }).click();
await page.waitForURL(/\/search\?q=london/);
console.log("Search results:", await page.locator(".place-grid .place-tile").count());

// Map with rating markers and a selected-place card
await page.goto(base + "/map");
await page.waitForSelector(".rating-marker", { timeout: 60000 });
console.log("Map markers:", await page.locator(".rating-marker").count());
await page.locator(".rating-marker").first().click();
await page.waitForSelector(".map-selected");
await page.screenshot({ path: ".test-artifacts/map-desktop.png" });
await page.locator(".map-selected-close").click();
await page.waitForSelector(".map-selected", { state: "detached" });

// Place page
const firstPlace = await page.locator(".map-list .place-tile-title a").first().getAttribute("href");
if (firstPlace) {
  await page.goto(base + firstPlace);
  await page.waitForSelector(".place-title-row h1");
  await page.screenshot({ path: ".test-artifacts/place-desktop.png", fullPage: true });
}

// Mobile layout
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base);
await page.waitForSelector(".tab-bar");
await page.screenshot({ path: ".test-artifacts/explore-mobile.png" });
console.log(
  "Mobile overflow:",
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
);

assert.deepEqual(errors, []);
console.log("Browser checks passed.");
await browser.close();
