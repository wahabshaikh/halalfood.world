/**
 * Test sign-in for local development, CI and pull request previews.
 *
 * Any address at `TEST_EMAIL_DOMAIN` signs in with `TEST_OTP`: no email is
 * sent, and the bot check and send limits are skipped for it, so people and
 * agents can verify signed-in flows without a mailbox. This is the same idea
 * as Clerk's `+clerk_test` addresses.
 *
 * It only switches on when `BETTER_AUTH_URL` points at a local server or a
 * `pr-<number>-…workers.dev` preview alias. Production runs at
 * https://halalfood.world, so it can never accept the fixed code there, even
 * if a preview's variables were somehow carried into a production version.
 */

export const TEST_OTP = "424242";
export const TEST_EMAIL_DOMAIN = "example.com";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PREVIEW_HOST = /^pr-\d+-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/;

/** Whether this deployment may accept the fixed test code. */
export function isAuthTestModeEnabled(
  baseUrl = process.env.BETTER_AUTH_URL?.trim() || "",
): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (LOCAL_HOSTS.has(url.hostname)) return true;
  return url.protocol === "https:" && PREVIEW_HOST.test(url.hostname);
}

/** Addresses at the reserved example.com domain; no real person owns one. */
export function isTestEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return at > 0 && normalized.slice(at + 1) === TEST_EMAIL_DOMAIN;
}

/** A test address on a deployment where test sign-in is allowed. */
export function usesTestSignIn(email: unknown, baseUrl?: string): boolean {
  return isTestEmail(email) && isAuthTestModeEnabled(baseUrl);
}
