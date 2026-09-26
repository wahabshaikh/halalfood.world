import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";

// Verification sets this to its own directory. Unset, local D1 stays in
// apps/web/.wrangler/state, which is the developer's database.
const persistPath = process.env.HALALFOOD_PERSIST_PATH?.trim();

export default defineConfig({
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
