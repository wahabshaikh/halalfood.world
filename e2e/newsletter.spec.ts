import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { newUser } from "./support/helpers";

test("newsletter explains the offer and renders without configuration @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.goto("/newsletter"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Newsletter");
  await expect(page.getByText("City picks to help you choose where to eat.")).toBeVisible();
  await expect(page.getByText("New places added by the community.")).toBeVisible();
  await expect(page.getByText("Sponsor slots for businesses supporting the guide.")).toBeVisible();
  await expect(page.getByText("Sponsors never affect", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Newsletter", exact: true })).toHaveAttribute("href", "/newsletter");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  expect(errors).toEqual([]);
});

test("newsletter unconfigured state is accessible and signed-in checkout returns 503", async ({ browser }) => {
  const { page, context } = await newUser(browser, "newsletter");
  await page.goto("/newsletter");
  await expect(page.getByRole("button", { name: "Not available yet" })).toBeDisabled();
  const response = await page.request.post("/api/newsletter/checkout", { data: {} });
  expect(response.status()).toBe(503);
  expect((await response.json()).error).toContain("not available yet");
  const results = await new AxeBuilder({ page }).exclude("[data-wordmark]").analyze();
  expect(results.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => item.id)).toEqual([]);
  await context.close();
});

test("newsletter checkout requires sign-in", async ({ request }) => {
  expect((await request.post("/api/newsletter/checkout", { data: {} })).status()).toBe(401);
});
