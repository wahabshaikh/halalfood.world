import { expect, test } from "@playwright/test";

// Client request loops: every /api/** call is answered in the browser with a forced status (nothing
// reaches the server), each page sits for a while, and an endpoint requested too often fails the test.
// Slow (pages x modes x seconds), so it is tagged @loops and skipped by default:
//   LOOP_AUDIT=1 pnpm e2e e2e/smoke/fetch-loops.spec.ts --project=chromium
const seconds = Number(process.env.LOOP_AUDIT_SECONDS || 8);
const MAX_PER_ENDPOINT = Number(process.env.LOOP_AUDIT_MAX || 6);
const pages = (process.env.LOOP_AUDIT_PAGES || "/,/map,/city/london,/search?q=grill,/friends,/inbox,/saved,/add,/me,/community,/events").split(",");
const modes = [
  { name: "guest-401", status: 401, signedIn: false },
  { name: "user-401", status: 401, signedIn: true },
  { name: "user-403", status: 403, signedIn: true },
  { name: "user-503", status: 503, signedIn: true },
];
const USER = { user: { id: "loop-audit", email: "loop-audit@example.com", name: "Loop audit" }, session: { id: "s" } };

test.describe("@loops", () => {
  test.skip(!process.env.LOOP_AUDIT, "set LOOP_AUDIT=1 to run the request-loop audit");
  test.use({ viewport: { width: 390, height: 844 } });

  for (const mode of modes) {
    for (const path of pages) {
      test(`${mode.name} ${path} does not loop`, async ({ page }) => {
        test.setTimeout((seconds + 40) * 1000);
        const counts: Record<string, number> = {};
        await page.route("**/api/**", (route) => {
          const url = new URL(route.request().url());
          const key = `${route.request().method()} ${url.pathname}`;
          counts[key] = (counts[key] ?? 0) + 1;
          if (url.pathname === "/api/auth/get-session") {
            return route.fulfill({ status: 200, contentType: "application/json", body: mode.signedIn ? JSON.stringify(USER) : "null" });
          }
          return route.fulfill({ status: mode.status, contentType: "application/json", body: JSON.stringify({ error: `forced ${mode.status}` }) });
        });
        await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForTimeout(seconds * 1000);
        const [endpoint, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["none", 0];
        expect(count, `${endpoint} was requested ${count} times`).toBeLessThanOrEqual(MAX_PER_ENDPOINT);
      });
    }
  }
});
