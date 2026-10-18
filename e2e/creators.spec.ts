import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The seed's unclaimed creator (seed/local.sql), as Halal Food Scout makes them. Not @smoke: production has no seed.
const PLACE = "00000000-0000-4000-8000-000000000001";

test("an unclaimed creator's profile shows the channel, the claim note and verified places", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.goto("/u/seed.creator"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seed Creator");
  await expect(page.getByRole("link", { name: /YouTube.*12\.5K subscribers/ })).toHaveAttribute("href", "https://www.youtube.com/@seed.creator");
  await expect(page.getByText("Unclaimed. Is this you?")).toBeVisible();
  await expect(page.getByRole("link", { name: "Claim it" })).toHaveAttribute("href", /^mailto:salam@halalfood\.world/);
  await expect(page.getByRole("button", { name: /follow/i })).toHaveCount(0);
  const verified = page.getByRole("region", { name: "Verified in videos" });
  await expect(verified.getByRole("link", { name: "Seed Grill House" })).toHaveAttribute("href", `/place/${PLACE}`);
  await expect(verified.getByRole("link", { name: "Watch at 1:23" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=seedvideo01&t=83s");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  const results = await new AxeBuilder({ page }).exclude("[data-wordmark]").analyze();
  expect(results.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => item.id)).toEqual([]);
});

test("the place page says which creator verified it in a video, and keeps its status", async ({ page }) => {
  await page.goto(`/place/${PLACE}`);
  const creators = page.getByRole("region", { name: "From creators" });
  await expect(creators).toContainText("Verified by Seed Creator in a video");
  await expect(creators).toContainText("@seed.creator · at 1:23 · Sep 2026");
  await expect(creators.getByRole("link", { name: "Watch" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=seedvideo01&t=83s");
  await expect(creators.getByRole("link", { name: "Seed Creator", exact: true })).toHaveAttribute("href", "/u/seed.creator");
  await expect(page.getByText("A video is taste, not a halal check.", { exact: false }).first()).toBeVisible();
});

test("the creator page links to the creator's profile", async ({ page }) => {
  await page.goto("/creator/youtube/seed.creator");
  await expect(page.getByRole("link", { name: "See @seed.creator’s profile" })).toHaveAttribute("href", "/u/seed.creator");
});

test("the Scout endpoint is closed without the admin secret @smoke", async ({ request }) => {
  const get = await request.get("/api/mcp");
  expect(get.status()).toBe(405);
  const post = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  // 503 where MCP_ADMIN_SECRET isn't set (local, Previews), 401 where it is: never open.
  expect([401, 503]).toContain(post.status());
  const wrong = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers: { authorization: "Bearer not-the-secret" } });
  expect([401, 503]).toContain(wrong.status());
});
