import { expect, test, type APIRequestContext } from "@playwright/test";

/** Test sign-in: any example.com address, on local servers and previews. */
export const TEST_OTP = "424242";

/** Where the setup project saves the shared signed-in browser state. */
export const USER_STATE = ".test-artifacts/auth/user.json";

/** A fresh test address, unique per call, so tests never share a user. */
export function testEmail(label = "e2e"): string {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${label}-${unique}@example.com`;
}

/**
 * Sign in through the real email OTP endpoints. Pass `page.request` (or
 * `context.request`) and the session cookie lands in that browser context.
 */
export async function signIn(request: APIRequestContext, email = testEmail()) {
  // Better Auth checks Origin on cookie-setting POSTs, like a browser sends.
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("signIn needs a baseURL in playwright.config.ts");
  const headers = { origin: new URL(baseURL).origin };

  const sent = await request.post("/api/auth/email-otp/send-verification-otp", {
    headers,
    data: { email, type: "sign-in" },
  });
  expect(sent.status(), await sent.text()).toBe(200);

  const signedIn = await request.post("/api/auth/sign-in/email-otp", {
    headers,
    data: { email, otp: TEST_OTP },
  });
  expect(signedIn.status(), await signedIn.text()).toBe(200);
  const body = (await signedIn.json()) as { user: { id: string; email: string } };
  return body.user;
}

