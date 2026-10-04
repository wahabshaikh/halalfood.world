import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  applyPreviewResourceBindings,
  applyTurnstileSiteKey,
  PREVIEW_D1_ID,
  PREVIEW_D1_NAME,
  PREVIEW_R2_BUCKET,
  previewIsolationDecision,
} from "../apps/web/src/lib/preview-bindings.ts";

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

const generatedConfigPath = "dist/server/wrangler.json";
const generatedConfig = JSON.parse(readFileSync(generatedConfigPath, "utf8"));
applyTurnstileSiteKey(generatedConfig, process.env.TURNSTILE_SITE_KEY);

const isolation = previewIsolationDecision(process.env);
if (isolation === "refuse") {
  console.error(
    "WORKERS_CI is set but WORKERS_CI_BRANCH is empty. Refusing to upload because the production D1 and R2 bindings would be used.",
  );
  process.exit(1);
}

if (isolation === "preview") {
  applyPreviewResourceBindings(generatedConfig);
  const rootCopy = JSON.parse(
    readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""),
  );
  applyPreviewResourceBindings(rootCopy);
  applyTurnstileSiteKey(rootCopy, process.env.TURNSTILE_SITE_KEY);
  writeFileSync("wrangler.jsonc", `${JSON.stringify(rootCopy, null, 2)}\n`);
  console.log(
    `Non-main branch ${process.env.WORKERS_CI_BRANCH}: DB ${PREVIEW_D1_NAME} (${PREVIEW_D1_ID}), R2 ${PREVIEW_R2_BUCKET}`,
  );
  const previewConfigPath = ".wrangler/preview-d1.json";
  writeFileSync(
    previewConfigPath,
    `${JSON.stringify({
      name: PREVIEW_D1_NAME,
      d1_databases: [
        {
          binding: "DB",
          database_name: PREVIEW_D1_NAME,
          database_id: PREVIEW_D1_ID,
          migrations_dir: "../migrations",
        },
      ],
    })}\n`,
  );
  const migrated = spawnSync(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", previewConfigPath],
    { stdio: "inherit" },
  );
  if (migrated.status !== 0) {
    console.error("Preview D1 migration failed. Production was not migrated.");
    process.exit(migrated.status ?? 1);
  }
}

writeFileSync(generatedConfigPath, `${JSON.stringify(generatedConfig)}\n`);
