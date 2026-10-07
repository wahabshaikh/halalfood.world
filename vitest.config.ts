import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts", "lib/**/*.d.ts", "lib/db/**", "lib/testing/**", "lib/auth-client.ts", "lib/analytics.ts"],
      // A ratchet, not a target: raise these as coverage grows (mosques.world gates at 80% lines).
      // The pure domain rules in lib/core keep the higher bar.
      thresholds: {
        lines: 65,
        statements: 65,
        functions: 70,
        branches: 70,
        "lib/core/**": { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
      "cloudflare:workers": new URL("./lib/testing/cloudflare-workers.ts", import.meta.url).pathname,
    },
  },
});
