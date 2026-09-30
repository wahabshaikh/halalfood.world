import type { Page } from "@playwright/test";

/**
 * Replace the Turnstile widget with one that passes at once. Test addresses
 * skip the server-side check, so this keeps sign-in tests off Cloudflare's
 * network and working on previews, whose real site key may not allow the
 * preview hostname.
 */
export async function stubTurnstile(page: Page) {
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = {
        render(container, options) {
          setTimeout(() => options.callback("XXXX.DUMMY.TOKEN.XXXX"), 0);
          return "stub";
        },
        remove() {},
      };`,
    }),
  );
}
