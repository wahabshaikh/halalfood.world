import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end checks, public and signed in.
 *
 * - `npm run test:e2e` builds the app and serves it on a seeded local D1.
 * - `TEST_BASE_URL=<url> npm run test:e2e` runs against a server you already
 *   have (a `npm run dev` server, or a pull request preview) instead.
 *
 * Signed-in tests use test sign-in (`*@example.com` with code 424242), which
 * only works on local servers and previews. See docs/verification.md.
 */
const externalBaseUrl = process.env.TEST_BASE_URL?.replace(/\/$/, "");
const port = process.env.E2E_PORT || "8787";
const baseURL = externalBaseUrl || `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".test-artifacts/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: ".test-artifacts/e2e-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: ".test-artifacts/e2e-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // Set when a sandbox ships its own Chromium instead of `npx playwright install`.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      // Sandboxes whose outbound traffic must go through a proxy (the map
      // tiles and fonts are external). Local servers are never proxied.
      proxy: process.env.PLAYWRIGHT_PROXY
        ? { server: process.env.PLAYWRIGHT_PROXY, bypass: "localhost,127.0.0.1" }
        : undefined,
      // WebGL for the map in headless Chromium.
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      testMatch: /public\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "node scripts/e2e-server.mjs",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: "ignore",
      },
});
