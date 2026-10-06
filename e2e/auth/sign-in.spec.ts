import { expect, test } from "@playwright/test";
import { identity, latestOtp, newUser, stubTurnstile } from "../support/helpers";

test("sign in with an emailed code, then reach a signed-in page", async ({ page }) => {
  const person = identity("signin");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": person.ip });
  await stubTurnstile(page);
  await page.goto("/login?returnTo=%2Fsaved");
  // The button enables once there's an email and Turnstile has handed over a token. Typing before
  // hydration is lost (the input is controlled), so refill until it sticks.
  const send = page.getByRole("button", { name: "Send code" });
  await expect(async () => {
    await page.getByLabel("Email").fill(person.email);
    await expect(send).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await send.click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("Code").fill(await latestOtp(page.request, person.email));
  // A new account goes through /welcome first.
  await page.waitForURL(/\/(welcome|saved)/);
  const me = await page.request.get("/api/me");
  expect(me.ok()).toBeTruthy();
  expect(((await me.json()) as { email: string }).email).toBe(person.email);
});

test("the test session endpoint signs a person in with one request", async ({ browser }) => {
  const { page, person, user, context } = await newUser(browser, "session", { name: "Session Tester" });
  expect(user.handle).toBeTruthy();
  const me = (await (await page.request.get("/api/me")).json()) as { email: string; profile: { onboarded: boolean } };
  expect(me.email).toBe(person.email);
  expect(me.profile.onboarded).toBe(true);
  const response = await page.goto("/saved");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/saved/);
  await context.close();
});

test("signed-out API writes are refused", async ({ request }) => {
  const response = await request.post("/api/lists", { data: { title: "Nope" } });
  expect(response.status()).toBe(401);
});
