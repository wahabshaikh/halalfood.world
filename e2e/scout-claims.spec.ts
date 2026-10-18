import { expect, test, type Page } from "@playwright/test";

// Places Halal Food Scout listed with sourced web claims (seed/local.sql). Not @smoke: production has no seed.
// Seed Scout Kitchen: certified yes (HMC), Muslim-owned yes, no pork; alcohol unknown. Seed Falafel Stop: no alcohol only.
const KITCHEN = "00000000-0000-4000-8000-000000000007";
const FALAFEL = "00000000-0000-4000-8000-000000000008";

async function rowNames(page: Page) {
  return page.locator("main li a[href^='/place/'] span.truncate.font-extrabold").allTextContents();
}

test("the four filter chips match places on their web claims; unknown never matches", async ({ page }) => {
  // An empty filters param keeps remembered filters out of the way.
  await page.goto("/city/london?filters=");
  // The chips are client components: wait for hydration before clicking.
  await page.waitForLoadState("networkidle");
  const chips = page.getByRole("group", { name: "Filters" });
  for (const [chip, key, kitchen, falafel] of [
    ["Halal certified", "certified", true, false],
    ["Muslim-owned", "owned", true, false],
    ["No pork", "no-pork", true, false],
    ["No alcohol", "no-alcohol", false, true],
  ] as const) {
    await chips.getByRole("button", { name: chip }).click();
    await page.waitForURL((url) => url.searchParams.get("filters") === key);
    await page.waitForLoadState("networkidle");
    await expect(chips.getByRole("button", { name: chip })).toHaveAttribute("aria-pressed", "true");
    const names = await rowNames(page);
    expect(names.includes("Seed Scout Kitchen"), chip).toBe(kitchen);
    expect(names.includes("Seed Falafel Stop"), chip).toBe(falafel);
    // Turn it off again before the next chip.
    await chips.getByRole("button", { name: chip }).click();
    await page.waitForURL((url) => url.searchParams.get("filters") === "");
    await page.waitForLoadState("networkidle");
    await expect(chips.getByRole("button", { name: chip })).toHaveAttribute("aria-pressed", "false");
  }
  // Web claims never make a place Verified.
  await chips.getByRole("button", { name: "Verified" }).click();
  await page.waitForURL((url) => url.searchParams.get("filters") === "verified");
  await expect(chips.getByRole("button", { name: "Verified" })).toHaveAttribute("aria-pressed", "true");
  const verified = await rowNames(page);
  expect(verified).not.toContain("Seed Scout Kitchen");
  expect(verified).not.toContain("Seed Falafel Stop");
});

test("the places API applies the same filters to web claims", async ({ request }) => {
  const ids = async (filters: string) =>
    ((await (await request.get(`/api/places?city=london&limit=100&filters=${filters}`)).json()).places as { id: string }[]).map((place) => place.id);
  expect(await ids("owned,certified,no-pork")).toContain(KITCHEN);
  expect(await ids("owned,certified,no-pork")).not.toContain(FALAFEL);
  expect(await ids("no-alcohol")).toContain(FALAFEL);
  expect(await ids("no-alcohol")).not.toContain(KITCHEN);
  expect(await ids("verified")).not.toContain(KITCHEN);
});

test("the place page links each web source, keeps unknown as unknown and stays Not checked yet", async ({ page }) => {
  await page.goto(`/place/${KITCHEN}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seed Scout Kitchen");
  const facts = page.getByRole("region", { name: "Halal facts" });
  const tile = (question: string) => facts.locator("div.rounded-2xl").filter({ hasText: question });
  await expect(tile("Halal certified")).toContainText("Yes");
  await expect(tile("Halal certified").getByRole("link", { name: "Web source (HMC)" })).toHaveAttribute("href", "https://example.com/seed-scout-kitchen/halal");
  await expect(tile("Muslim-owned")).toContainText("Yes");
  await expect(tile("Muslim-owned").getByRole("link", { name: "Web source" })).toHaveAttribute("href", "https://example.com/seed-scout-kitchen/about");
  await expect(tile("Pork")).toContainText("Not served");
  // Alcohol has no claim: it reads as unknown, never as "Not served" or "Served".
  await expect(tile("Alcohol")).toContainText("Not known yet");
  await expect(tile("Alcohol")).not.toContainText("Served");
  await expect(tile("Alcohol").getByRole("link")).toHaveCount(0);
  await expect(facts).toContainText("A web source is what a page online says, not a check.");
  await expect(page.getByText("Not checked yet").first()).toBeVisible();
});
