import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);
// CI (and E2E_BUILD=1) tests the production build in workerd via `vite preview`; locally the dev server is faster.
const build = ci || process.env.E2E_BUILD === "1";
// Sandboxes that ship their own Chromium (and can't run `playwright install`) point at it here.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  // Suites share one database (local or preview), so they run one file at a time.
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    // The app is phone-first: pages also run at phone size.
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], launchOptions: { executablePath } }, testMatch: /smoke\/pages/ },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: build
          ? "pnpm db:migrate:local && pnpm db:seed:local && pnpm build && pnpm exec vite preview --port 5173 --host 127.0.0.1 --strictPort"
          : "pnpm db:migrate:local && pnpm db:seed:local && pnpm dev",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !ci,
        timeout: 300_000,
      },
});
