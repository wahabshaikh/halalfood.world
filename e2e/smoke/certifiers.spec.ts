import { expect, test } from "@playwright/test";

// The certifier directory is reference data from migrations (BPJPH's list of 17 Oct 2026), so these hold
// locally, on Previews and in production. Dates are checked as the official list gives them.

test("the hub finds a certifier by name and links to its page @smoke", async ({ page }) => {
  await page.goto("/certifiers");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Halal certification bodies");
  // Typing before hydration is lost (the input is controlled), so refill until the filter applies.
  await expect(async () => {
    const search = page.getByRole("searchbox", { name: "Type your certifier" });
    await search.fill("");
    await search.fill("anic halal");
    await expect(page.getByText(/^1 of \d+ certifiers$/)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 25_000 });
  await page.getByRole("link", { name: "ANIC Halal Authority" }).click();
  await expect(page).toHaveURL(/\/certifiers\/anic-halal-authority$/);
});

test("Indonesia's page shows BPJPH's list with the official link, date and disclaimer @smoke", async ({ page }) => {
  await page.goto("/certifiers/country/indonesia");
  await expect(page).toHaveTitle(/^BPJPH recognised foreign halal certification bodies \(updated \d{1,2} \w{3} \d{4}\) \| halalfood\.world$/);
  await expect(page.getByText("Always confirm with the authority before shipping.")).toBeVisible();
  await expect(page.getByRole("link", { name: "BPJPH's official list" })).toHaveAttribute("href", "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri");
  const rows = page.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(100);
  // A click before hydration does nothing, so click until the sort applies.
  await expect(async () => {
    await page.getByRole("button", { name: "Valid until" }).click();
    await expect(page.locator("th[aria-sort=ascending]")).toHaveText(/Valid until/, { timeout: 1_000 });
  }).toPass({ timeout: 25_000 });
  const csv = await page.request.get("/certifiers/country/indonesia.csv");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("ANIC Halal Authority");
});

test("ANIC Halal Authority is recognised by BPJPH until 30 Jun 2030 @smoke", async ({ page }) => {
  await page.goto("/certifiers/anic-halal-authority");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ANIC Halal Authority");
  await expect(page.getByText("30 Jun 2030").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "See the official list" })).toBeVisible();
  const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(ld).toContain('"@type":"Organization"');
});

test("the read-only API and the feed answer @smoke", async ({ request }) => {
  const one = await request.get("/api/certifiers/anic-halal-authority");
  expect(one.ok()).toBeTruthy();
  const body = (await one.json()) as { recognitions: { authority: string; validUntil: string | null }[] };
  expect(body.recognitions.find((rec) => rec.authority === "bpjph")?.validUntil).toBe("2030-06-30");
  expect((await request.get("/api/certifiers/no-such-certifier-here")).status()).toBe(404);
  const feed = await request.get("/certifiers/changes.xml");
  expect(feed.headers()["content-type"]).toContain("application/atom+xml");
});
