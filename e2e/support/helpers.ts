import { expect, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";

export const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

/** Ids from seed/local.sql. Against a Preview, use whatever /api/places returns instead. */
export const SEED_PLACE_ID = "00000000-0000-4000-8000-000000000001";

let counter = 0;

/** A unique identity per run so suites can be re-run against the same database. */
export function identity(prefix: string) {
  counter += 1;
  const stamp = `${Date.now().toString(36)}${counter}`;
  return {
    email: `${prefix}.${stamp}@example.com`,
    // Per-person IP so the per-IP sign-in budgets don't collide across tests.
    ip: `198.51.100.${(Date.now() + counter * 7) % 250}`,
  };
}

/** The newest sign-in code sent to `email`, read from the non-production email sink. */
export async function latestOtp(request: APIRequestContext, email: string): Promise<string> {
  let code = "";
  await expect
    .poll(async () => {
      const response = await request.get(`/api/test/emails?to=${encodeURIComponent(email)}`);
      const body = (await response.json()) as { messages: Array<{ text: string }> };
      code = body.messages[0]?.text.match(/sign-in code is (\d{6})/)?.[1] ?? "";
      return code;
    })
    .toMatch(/^\d{6}$/);
  return code;
}

export type SessionFixture = {
  name?: string;
  /** false stops before /welcome. */
  onboarded?: boolean;
  moderator?: boolean;
  /** Checks only count from accounts at least a day old; the endpoint defaults to 2 days. */
  ageDays?: number;
};

/**
 * Signs `email` in with one request to the local/preview-only session endpoint, creating the account
 * if needed. The cookie lands in the context's jar, so `page`, `page.request` and `context.request`
 * are all signed in. Only the sign-in test itself goes through the email code UI.
 */
export async function signIn(context: BrowserContext, email: string, fixture: SessionFixture = {}) {
  const response = await context.request.post("/api/test/session", { data: { email, ...fixture } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { user: { id: string; email: string; handle: string | null } }).user;
}

/** A fresh, signed-in person in their own browser context. */
export async function newUser(browser: Browser, prefix: string, fixture: SessionFixture = {}, options: BrowserContextOptions = {}) {
  const person = identity(prefix);
  const context = await browser.newContext({ ...options, baseURL });
  const user = await signIn(context, person.email, fixture);
  const page = await context.newPage();
  return { context, page, person, user };
}

/** Cloudflare's dummy token, accepted by the always-pass test secret that non-production hosts use. */
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * Serves a stand-in for Turnstile's api.js that hands the widget the dummy token at once, so the
 * sign-in UI test doesn't depend on the browser reaching challenges.cloudflare.com (sandboxes often
 * can't). The server still verifies the token with Cloudflare using the test secret.
 */
export async function stubTurnstile(page: Page) {
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile = {
        render(el, options) { setTimeout(() => options.callback(${JSON.stringify(TURNSTILE_TEST_TOKEN)}), 50); return "stub"; },
        reset() {}, remove() {},
      };`,
    }),
  );
}
