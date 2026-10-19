import { expect, test } from "@playwright/test";

test("directions remembers the selected maps app", async ({ page, request }) => {
  const all = await (await request.get("/api/places?bbox=-180,-90,180,90&limit=1")).json();
  const place = all.places[0] as { id: string };
  await page.goto(`/place/${place.id}`);
  const directions = page.getByRole("link", { name: "Directions", exact: true });
  const apps = page.getByRole("combobox", { name: "Maps app for directions" });
  await expect(directions).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\//);
  await apps.selectOption("apple");
  await expect(directions).toHaveAttribute("href", /^https:\/\/maps\.apple\.com\/\?daddr=/);
  await page.reload();
  await expect(apps).toHaveValue("apple");
  await expect(directions).toHaveAttribute("href", /^https:\/\/maps\.apple\.com\/\?daddr=/);
  await apps.selectOption("google");
  await page.reload();
  await expect(apps).toHaveValue("google");
  await expect(directions).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\//);
});

test("iPhone directions defaults to Apple even when storage is unavailable", async ({ browser, request, baseURL }) => {
  const all = await (await request.get("/api/places?bbox=-180,-90,180,90&limit=1")).json();
  const place = all.places[0] as { id: string };
  const context = await browser.newContext({ baseURL, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage unavailable"); } });
    });
    const page = await context.newPage();
    await page.goto(`/place/${place.id}`);
    const apps = page.getByRole("combobox", { name: "Maps app for directions" });
    const directions = page.getByRole("link", { name: "Directions", exact: true });
    await expect(apps).toHaveValue("apple");
    await expect(directions).toHaveAttribute("href", /^https:\/\/maps\.apple\.com\//);
    await apps.selectOption("google");
    await expect(directions).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\//);
  } finally {
    await context.close();
  }
});
