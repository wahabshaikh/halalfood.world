// Browser check for client request loops. Every /api/** call is answered
// locally with a forced status (no request reaches the server), each page sits
// for a while, and any endpoint requested more than MAX_PER_ENDPOINT times
// fails the run. Usage:
//   TEST_BASE_URL=https://<preview>.workers.dev node tests/fetch-loop-audit.mjs
import { chromium } from "@playwright/test";

const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const seconds = Number(process.env.LOOP_AUDIT_SECONDS || 20);
const MAX_PER_ENDPOINT = Number(process.env.LOOP_AUDIT_MAX || 6);
const pages = (process.env.LOOP_AUDIT_PAGES ||
  "/,/map,/map?city=london,/feed,/activity,/city/london,/search?q=grill,/settings,/passport,/lists,/saved,/add,/onboarding,/leaderboard,/events,/recs,/contributions"
).split(",");
const modes = [
  { name: "guest-401", status: 401, signedIn: false },
  { name: "user-401", status: 401, signedIn: true },
  { name: "user-403", status: 403, signedIn: true },
  { name: "user-503", status: 503, signedIn: true },
];
const USER = { user: { id: "loop-audit", email: "loop-audit@example.com", name: "Loop audit" }, session: { id: "s" } };

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const failures = [];
for (const mode of modes) {
  for (const path of pages) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const counts = {};
    await context.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const key = `${route.request().method()} ${url.pathname}`;
      counts[key] = (counts[key] || 0) + 1;
      if (url.pathname === "/api/auth/get-session")
        return route.fulfill({ status: 200, contentType: "application/json", body: mode.signedIn ? JSON.stringify(USER) : "null" });
      return route.fulfill({ status: mode.status, contentType: "application/json", body: JSON.stringify({ error: `forced ${mode.status}` }) });
    });
    const page = await context.newPage();
    await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(seconds * 1000);
    const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["none", 0];
    const line = { mode: mode.name, path, total: Object.values(counts).reduce((a, b) => a + b, 0), worst };
    console.log(JSON.stringify(line));
    if (worst[1] > MAX_PER_ENDPOINT) failures.push(line);
    await context.close();
  }
}
await browser.close();
if (failures.length) {
  console.error(`Request loops found:\n${failures.map((f) => JSON.stringify(f)).join("\n")}`);
  process.exit(1);
}
