import { TEST_OTP, testEmail } from "./support/auth";
import { expect, test } from "./support/test";
import { stubTurnstile } from "./support/turnstile";

// The real sign-in UI: email, bot check, 6-digit code, then onboarding for a
// first-time user. Uses test sign-in, so no email is sent.

test.beforeEach(async ({ page }) => stubTurnstile(page));

test("a new user signs in with an emailed code and lands on onboarding", async ({ page }) => {
  const email = testEmail("ui");
  await page.goto("/login?returnTo=%2Fsaved");

  await page.getByLabel("Email address").fill(email);
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(page.getByRole("status")).toHaveText(`Code sent to ${email}.`);
  await page.getByLabel("6-digit code").fill(TEST_OTP);

  await page.waitForURL(/\/onboarding\?returnTo=%2Fsaved/);
  await expect(page.locator("#onboarding-title")).toBeVisible();

  const session = await page.request.get("/api/auth/get-session");
  expect((await session.json())?.user?.email).toBe(email);
});

test("a wrong code is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(testEmail("wrong-code"));
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await page.getByLabel("6-digit code").fill("000000");
  await expect(page.getByRole("alert")).toContainText("That code is not valid");
  const session = await page.request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();
});
