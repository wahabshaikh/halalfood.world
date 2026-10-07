/**
 * Screenshots pages of a running local or preview server, optionally signed in, so a change can be
 * checked by eye (or by an agent reading the PNG) without clicking through sign-in.
 *
 *   pnpm shot /me /saved --as amina@example.com [--moderator] [--mobile] [--dark]
 *             [--base http://127.0.0.1:5173] [--out .artifacts/screenshots]
 *
 * Signing in uses the preview/local-only /api/test/session endpoint (see scripts/dev-session.ts).
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a system Chromium instead of Playwright's download.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, devices } from "@playwright/test";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    as: { type: "string" },
    moderator: { type: "boolean", default: false },
    mobile: { type: "boolean", default: false },
    dark: { type: "boolean", default: false },
    full: { type: "boolean", default: true },
    base: { type: "string", default: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173" },
    out: { type: "string", default: ".artifacts/screenshots" },
  },
});

const paths = positionals.length > 0 ? positionals : ["/"];
const base = values.base ?? "http://127.0.0.1:5173";
const out = values.out ?? ".artifacts/screenshots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const context = await browser.newContext({
  ...(values.mobile ? devices["iPhone 13"] : { viewport: { width: 1440, height: 900 } }),
  baseURL: base,
  colorScheme: values.dark ? "dark" : "light",
});
// iPhone 13 defaults to WebKit; this script always drives Chromium with the phone viewport.
if (values.as) {
  const response = await context.request.post("/api/test/session", {
    data: { email: values.as, moderator: values.moderator },
  });
  if (!response.ok()) {
    console.error(`Sign-in failed (${response.status()}): ${await response.text()}`);
    await browser.close();
    process.exit(1);
  }
  const { user } = (await response.json()) as { user: { handle: string | null } };
  console.log(`Signed in as @${user.handle ?? "(no profile)"}`);
}

const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

let failed = false;
for (const path of paths) {
  const response = await page.goto(path, { waitUntil: "networkidle" });
  const file = join(out, `${path.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "_") || "home"}${values.mobile ? "@mobile" : ""}${values.dark ? "@dark" : ""}.png`);
  await page.screenshot({ path: file, fullPage: values.full });
  const status = response?.status() ?? 0;
  if (status >= 400) failed = true;
  console.log(`${status} ${path} -> ${page.url().replace(base, "") || "/"}  ${file}`);
}
if (errors.length > 0) console.log(`\nBrowser errors:\n${[...new Set(errors)].map((error) => `  ${error}`).join("\n")}`);
await browser.close();
process.exit(failed ? 1 : 0);
