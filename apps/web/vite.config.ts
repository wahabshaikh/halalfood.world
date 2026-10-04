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

// Verification sets this to its own directory. Unset, local D1 stays in
// apps/web/.wrangler/state, which is the developer's database.
const persistPath = process.env.HALALFOOD_PERSIST_PATH?.trim();

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
      persistState: persistPath ? { path: persistPath } : true,
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
