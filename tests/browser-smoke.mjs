import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
await mkdir(".test-artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
await page.waitForSelector(".food-marker", { timeout: 60000 });
await page.screenshot({ path: ".test-artifacts/desktop.png" });
console.log("Desktop markers:", await page.locator(".food-marker").count());

await page.locator(".map-place-card-main").first().click();
await page.waitForSelector(".selected-preview");
console.log(
  "Selected preview visible:",
  await page.locator(".selected-preview h2").first().textContent(),
);
await page.locator(".selected-preview-close").first().click();
await page.waitForSelector(".selected-preview", { state: "detached" });

await page
  .getByRole("textbox", { name: "Search for halal food" })
  .fill("london");
await page.waitForSelector(".map-search-result");
console.log(
  "Search result count:",
  await page.locator(".map-search-result").count(),
);
await page.locator(".map-search-result").first().click();
await page.waitForSelector(".selected-preview");

await page.setViewportSize({ width: 390, height: 844 });
await page.locator(".mobile-selected-preview .selected-preview-close").click();
await page.locator(".sheet-handle").click();
await page.waitForSelector(".mobile-results-sheet.sheet-half, .mobile-results-sheet.sheet-expanded");
await page.waitForTimeout(1000);
await page.screenshot({ path: ".test-artifacts/mobile.png" });
console.log(
  "Mobile overflow:",
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
);
assert.deepEqual(errors, []);
console.log("Browser checks passed.");
await browser.close();
