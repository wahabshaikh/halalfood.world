import { signIn, USER_STATE } from "./support/auth";
import { expect, test } from "./support/test";

// Signed-in journeys. Two ways to get a user:
// - `test.use({ storageState: USER_STATE })` reuses the user from auth.setup.ts,
//   fastest for read-only checks.
// - `await signIn(page.request)` makes a fresh user for a test that changes data.

test.describe("shared user", () => {
  test.use({ storageState: USER_STATE });

  test("the session is live and saved places load", async ({ page }) => {
    const session = await page.request.get("/api/auth/get-session");
    expect((await session.json())?.user?.email).toMatch(/@example\.com$/);

    await page.goto("/saved");
    await expect(page.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
  });
});

test("saving a place shows it on the saved page", async ({ page, request }) => {
  await signIn(page.request);

  const nearby = await request.get("/api/places?bbox=72.8,18.8,73,19.2&limit=1");
  const [place] = (await nearby.json()).places as { id: string; name: string }[];
  expect(place, "seeded places are missing; see seed/places.sql").toBeTruthy();

  await page.goto(`/place/${place.id}`);
  await page.getByRole("button", { name: "Save this place" }).first().click();
  await expect(
    page.getByRole("button", { name: "Remove this place from saved places" }).first(),
  ).toBeVisible();

  await page.goto("/saved");
  await expect(page.getByText(place.name).first()).toBeVisible();
});
