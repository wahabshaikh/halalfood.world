import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newUser } from "./support/helpers";

// The seed (seed/local.sql) has a live sponsor in Mumbai and none in London. Not @smoke unless marked:
// production has no seed.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).exclude("[data-wordmark]").analyze();
  return results.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => `${item.id}: ${item.help}`);
}

test("the sponsor page explains the offer and lists cities @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.goto("/sponsor"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sponsor a city");
  await expect(page.getByText("never change a place's halal status", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a city" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  expect(errors).toEqual([]);
});

test("the sponsor page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/sponsor");
  expect(await seriousViolations(page)).toEqual([]);
});

test("a sponsored city shows its card on Explore, labelled and apart from the places", async ({ page }) => {
  await page.goto("/city/mumbai");
  const card = page.getByRole("complementary", { name: "Sponsor of Mumbai" });
  await expect(card).toContainText("Seed Sponsor");
  await expect(card).toContainText("Halal catering across Mumbai");
  const link = card.getByRole("link", { name: /Seed Sponsor/ });
  await expect(link).toHaveAttribute("href", "https://sponsor.example.com/");
  await expect(link).toHaveAttribute("rel", "sponsored noopener noreferrer");
  await expect(page.getByRole("complementary", { name: /Sponsor of/ })).toHaveCount(1);
  await page.goto("/city/london");
  await expect(page.getByRole("complementary", { name: /Sponsor of/ })).toHaveCount(0);
});

test("the directory and city page say when a city is taken", async ({ page }) => {
  await page.goto("/sponsor");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Find a city").fill("mumbai");
  await expect(page.getByRole("link", { name: /Mumbai.*Sponsored until/ })).toBeVisible();
  await page.goto("/sponsor/mumbai");
  await expect(page.getByText("Mumbai has a sponsor until", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue to payment/ })).toHaveCount(0);
});

test("signed out, an open city asks you to sign in", async ({ page }) => {
  await page.goto("/sponsor/london");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sponsor London");
  await expect(page.getByRole("link", { name: "Sign in to sponsor London" })).toHaveAttribute("href", /\/login\?.*sponsor%2Flondon/);
});

test("signed in, the form previews the card and validates before checkout", async ({ browser }) => {
  const { page, context } = await newUser(browser, "sponsor");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sponsor/london");
  // The form is a client component: wait for hydration before typing.
  await page.waitForLoadState("networkidle");
  const submit = page.getByRole("button", { name: /Continue to payment · \$\d+\/month/ });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Name on the card").fill("Test Kebab Co");
  await page.getByLabel("One line (optional)").fill("Late-night grills");
  await page.getByLabel("Link").fill("not a link");
  await expect(submit).toBeDisabled();
  await page.getByLabel("Link").fill("testkebab.example.com");
  await expect(page.getByText("Test Kebab Co")).toBeVisible();
  await expect(page.getByText("testkebab.example.com", { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();
  expect(await seriousViolations(page)).toEqual([]);

  // Without Whop keys (local, CI) the API says so and holds nothing.
  const response = await page.request.post("/api/sponsorships", {
    data: { citySlug: "london", name: "Test Kebab Co", linkUrl: "https://testkebab.example.com" },
  });
  if (response.status() === 503) {
    expect((await response.json()).error).toContain("Sponsorships are not available right now");
    await submit.click();
    await expect(page.getByText("Sponsorships are not available right now", { exact: false })).toBeVisible();
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("the sponsorship API validates input and needs a session", async ({ request, browser }) => {
  const anonymous = await request.post("/api/sponsorships", { data: { citySlug: "london", name: "X", linkUrl: "https://x.example.com" } });
  expect(anonymous.status()).toBe(401);
  const { page, context } = await newUser(browser, "sponsor-api");
  const bad = await page.request.post("/api/sponsorships", { data: { citySlug: "london", name: "X", linkUrl: "http://x.example.com" } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toBe("Add the https link people should visit.");
  await context.close();
});

test("the Whop webhook rejects unsigned deliveries @smoke", async ({ request }) => {
  const response = await request.post("/api/webhooks/whop", { data: { type: "payment.succeeded", data: { id: "pay_x" } } });
  // 503 where WHOP_WEBHOOK_SECRET isn't set (local, Previews without it), 401 where it is: never accepted.
  expect([401, 503]).toContain(response.status());
});
