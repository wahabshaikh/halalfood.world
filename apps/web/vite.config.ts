import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { resolveBrowserSentryDsn } from "./src/lib/sentry-options.js";

const browserSentryDsn = resolveBrowserSentryDsn(
  process.env.NEXT_PUBLIC_SENTRY_DSN,
  readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8"),
);

export default defineConfig({
  define: {
    __HALALFOOD_SENTRY_DSN__: JSON.stringify(browserSentryDsn),
  },
  // Keep MapLibre’s module worker paths intact in development.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  plugins: [
    vinext({
      cache: { cdn: cdnAdapter() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
