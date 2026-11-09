import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SEED_PLACE_ID, newUser } from "./support/helpers";

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).exclude("[data-wordmark]").analyze();
  return results.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => `${item.id}: ${item.help}`);
}

test("the claim page states the price and what payment does not change @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.goto("/claim"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Claim your restaurant");
  await expect(page.getByText("$29")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What payment does not do" })).toBeVisible();
  await expect(page.getByText("does not change halal status", { exact: false })).toBeVisible();
  await expect(page.getByText("Sponsored", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the claim page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/claim");
  expect(await seriousViolations(page)).toEqual([]);
});

test("a place offers claim, and checkout stays off without a plan id", async ({ page, browser }) => {
  await page.goto(`/place/${SEED_PLACE_ID}`);
  await expect(page.getByRole("link", { name: "Claim this restaurant" })).toBeVisible();

  const { context, page: signedIn } = await newUser(browser, "claim");
  await signedIn.goto(`/claim/${SEED_PLACE_ID}`);
  await expect(signedIn.getByRole("heading", { level: 1 })).toContainText("Claim");
  await expect(signedIn.getByRole("button", { name: "Not available yet" })).toBeDisabled();
  const response = await signedIn.request.post("/api/owner-claims", {
    data: { placeId: SEED_PLACE_ID, role: "owner", contactEmail: "owner@grill.example" },
  });
  expect(response.status()).toBe(503);
  await context.close();
});

test("claim checkout requires sign-in", async ({ request }) => {
  expect((await request.post("/api/owner-claims", { data: { placeId: SEED_PLACE_ID, role: "owner", contactEmail: "a@b.co" } })).status()).toBe(401);
});

test("a city page does not invent a sponsored restaurant block", async ({ page }) => {
  await page.goto("/city/london");
  await expect(page.getByRole("region", { name: "Sponsored" })).toHaveCount(0);
});
