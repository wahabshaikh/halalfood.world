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
await page.locator(".food-marker").last().click({ force: true });
await page.waitForSelector(".place-popup");
console.log(
  "Popup visible:",
  await page.locator(".place-popup h2").textContent(),
);
await page.locator(".maplibregl-popup-close-button").click();
await page.locator(".count-pill").click();
console.log(
  "Sheet opens:",
  await page.locator("dialog").evaluate((el) => el.open),
);
await page.keyboard.press("Escape");
await page
  .getByRole("textbox", { name: "Search for halal food" })
  .fill("london");
await page.waitForSelector(".search-results button");
console.log(
  "Search result count:",
  await page.locator(".search-results button").count(),
);
await page.locator(".search-results button").first().click();
await page.waitForSelector(".place-popup");
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Clear search" }).click();
await page.locator(".maplibregl-popup-close-button").click();
await page.waitForTimeout(2500);
await page.screenshot({ path: ".test-artifacts/mobile.png" });
console.log(
  "Mobile overflow:",
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
);
assert.deepEqual(errors, []);
console.log("Browser checks passed.");
await browser.close();
