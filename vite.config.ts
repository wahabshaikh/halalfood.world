import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { bakedSentryEnvironment, resolveBrowserSentryDsn } from "./lib/sentry-options";

const browserSentryDsn = resolveBrowserSentryDsn(
  process.env.NEXT_PUBLIC_SENTRY_DSN,
  readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8"),
);
const browserSentryEnvironment = bakedSentryEnvironment({
  ENVIRONMENT: process.env.ENVIRONMENT,
  WORKERS_CI: process.env.WORKERS_CI,
  WORKERS_CI_BRANCH: process.env.WORKERS_CI_BRANCH,
});

export default defineConfig({
  define: {
    __HALALFOOD_SENTRY_DSN__: JSON.stringify(browserSentryDsn),
    __HALALFOOD_SENTRY_ENVIRONMENT__: JSON.stringify(browserSentryEnvironment),
  },
  // Keep MapLibre’s module worker paths intact in development.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  plugins: [
    vinext({
      cache: { cdn: cdnAdapter() },
    }),
    tailwindcss(),
    cloudflare({
      // Set CLOUDFLARE_REMOTE_BINDINGS=1 (with a Cloudflare login) to use remote bindings in dev.
      remoteBindings: process.env.CLOUDFLARE_REMOTE_BINDINGS === "1",
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
    },
  },
});
