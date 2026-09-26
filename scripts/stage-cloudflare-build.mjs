import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

// Workers Builds and the pull_request_target preview workflow both run from
// the repository root. The workflow file that actually executes is the one on
// the base branch, so it still packs ./dist and ./migrations, and Wrangler
// still looks for wrangler.jsonc plus .wrangler/deploy/config.json here.
// The app build writes that layout under apps/web.
const appDir = "apps/web";

rmSync("dist", { recursive: true, force: true });
cpSync(`${appDir}/dist`, "dist", { recursive: true });

rmSync("migrations", { recursive: true, force: true });
cpSync(`${appDir}/migrations`, "migrations", { recursive: true });

cpSync(`${appDir}/wrangler.jsonc`, "wrangler.jsonc");

mkdirSync(".wrangler/deploy", { recursive: true });
writeFileSync(
  ".wrangler/deploy/config.json",
  `${JSON.stringify({
    configPath: "../../dist/server/wrangler.json",
    auxiliaryWorkers: [],
  })}\n`,
);
