// Serve the production build on a throwaway local D1 for end-to-end tests.
//
//   node scripts/e2e-server.mjs            build, migrate, seed, serve
//   E2E_SKIP_BUILD=1 node scripts/...      reuse dist/ (CI builds first)
//
// State lives in .wrangler/e2e so it never touches the `npm run dev` database.
// The Worker gets local-only settings through --var: test auth secret,
// Cloudflare's always-pass Turnstile test keys, and a localhost auth origin,
// which switches on test sign-in (src/lib/auth-test-mode.ts).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const port = process.env.E2E_PORT || "8787";
const persist = ".wrangler/e2e";
const config = "dist/server/wrangler.json";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.E2E_SKIP_BUILD !== "1") run("npx", ["vinext", "build"]);
if (!existsSync(config)) {
  console.error(`Missing ${config}. Run \`npm run build\` first.`);
  process.exit(1);
}

run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", persist]);
run("npx", ["wrangler", "d1", "execute", "DB", "--local", "--config", config, "--persist-to", persist, "--file", "seed/places.sql"]);

const vars = {
  BETTER_AUTH_URL: `http://localhost:${port}`,
  BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0000",
  // https://developers.cloudflare.com/turnstile/troubleshooting/testing/
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};
const server = spawn(
  "npx",
  [
    "wrangler", "dev",
    "--config", config,
    "--persist-to", persist,
    "--port", port,
    "--show-interactive-dev-session=false",
    ...Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
