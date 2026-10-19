import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Menus Halal Food Scout stored (seed/local.sql). Not @smoke: production has no seed.
// Seed Biryani Kitchen: 14 items in 5 sections, two sources, a clean menu check and a logo.
// Seed Shawarma Bar: a menu with a flagged check (alcohol). Seed Kebab Corner: a no_menu check.
const BIRYANI = "00000000-0000-4000-8000-000000000002";
const SHAWARMA = "00000000-0000-4000-8000-000000000003";
const KEBAB = "00000000-0000-4000-8000-000000000004";
const BADGE = "Menu checked: no alcohol · no pork";

test("the place page shows the menu by section with prices, folds a long one, and cites its sources", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.goto(`/place/${BIRYANI}`))?.status()).toBe(200);
  const menu = page.getByRole("region", { name: "Menu" });
  await expect(menu).toBeVisible();
  for (const section of ["Starters", "Biryani", "Grills"]) await expect(menu.getByRole("heading", { level: 3, name: section })).toBeVisible();
  const lamb = menu.locator("li").filter({ hasText: "Lamb biryani" });
  await expect(lamb).toContainText("£14.50");
  await expect(lamb).toContainText("Slow-cooked on the bone");

  // The first 10 items show; the rest wait behind "Show all".
  await expect(menu.getByText("Fresh lime soda")).toBeHidden();
  await menu.getByText("Show all 14 items").click();
  await expect(menu.getByText("Fresh lime soda")).toBeVisible();
  await expect(menu.locator("li").filter({ hasText: "Fresh lime soda" })).toContainText("£3.50");

  await expect(menu).toContainText("read by Halal Food Scout on 20 Sept 2026");
  await expect(menu.getByRole("link", { name: "Website" })).toHaveAttribute("href", "https://example.com/seed-biryani-kitchen/menu");
  await expect(menu.getByRole("link", { name: "Deliveroo" })).toHaveAttribute("href", "https://deliveroo.co.uk/menu/london/seed-biryani-kitchen");
  await expect(menu).toContainText("A menu isn’t a halal check.");

  const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='menu']").analyze();
  expect(axe.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => item.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a clean menu check shows the badge, with a tooltip that says what it is and isn't", async ({ page }) => {
  await page.goto(`/place/${BIRYANI}`);
  const facts = page.getByRole("region", { name: "Halal facts" });
  const badge = facts.getByRole("button", { name: BADGE });
  await expect(badge).toBeVisible();
  // The badge is context: the place is still Not checked yet and alcohol and pork stay unknown.
  await expect(page.getByText("Not checked yet").first()).toBeVisible();
  await expect(facts.locator("div.rounded-2xl").filter({ hasText: "Alcohol" })).toContainText("Not known yet");
  // Hydration wires up the tooltip.
  await page.waitForLoadState("networkidle");
  await badge.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("automated read of the menu");
  await expect(tooltip).toContainText("isn’t halal certification");
  await expect(tooltip).toContainText("isn’t a community check");
});

test("no badge for a flagged menu check or a no_menu check", async ({ page }) => {
  await page.goto(`/place/${SHAWARMA}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seed Shawarma Bar");
  // The menu still shows; the flagged check's Scout claim backs "Alcohol: Served" as a web source.
  await expect(page.getByRole("region", { name: "Menu" })).toContainText("Lager (bottle)");
  const facts = page.getByRole("region", { name: "Halal facts" });
  await expect(facts.locator("div.rounded-2xl").filter({ hasText: "Alcohol" })).toContainText("Served");
  await expect(page.getByText(BADGE)).toHaveCount(0);

  await page.goto(`/place/${KEBAB}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seed Kebab Corner");
  await expect(page.getByText(BADGE)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Menu" })).toHaveCount(0);
});

test("the logo shows on the place page and its card, https only, with no referrer and lazy loading", async ({ page }) => {
  await page.goto(`/place/${BIRYANI}`);
  const logo = page.getByRole("img", { name: "Seed Biryani Kitchen logo" });
  await expect(logo).toHaveAttribute("src", /^https:\/\//);
  await expect(logo).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(logo).toHaveAttribute("loading", "lazy");
  // A place without a logo has none.
  await page.goto(`/place/${KEBAB}`);
  await expect(page.getByRole("img", { name: /logo$/ })).toHaveCount(0);

  await page.goto("/city/london?filters=");
  const card = page.locator(`main li:has(a[href='/place/${BIRYANI}'])`).first();
  // A photo wins over the logo; the seed has none for this place, so the card shows the logo.
  const cardLogo = card.locator("img[data-place-logo]");
  await expect(cardLogo).toHaveAttribute("src", /^https:\/\//);
  await expect(cardLogo).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(cardLogo).toHaveAttribute("loading", "lazy");
});
