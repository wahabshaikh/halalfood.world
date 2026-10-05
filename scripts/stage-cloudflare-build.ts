import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  applyPreviewEnvironment,
  applyPreviewResourceBindings,
  enforcePreviewSecretBoundary,
  copyGoogleSearchWorkerConfig,
  parseWranglerJsonc,
  PREVIEW_D1_ID,
  PREVIEW_D1_NAME,
  PREVIEW_R2_BUCKET,
  previewIsolationDecision,
} from "../apps/web/src/lib/preview-bindings.ts";
import { readProductionSecretNames } from "./read-production-secret-names.ts";
import {
  MIGRATION_LIST_TIMEOUT_MS,
  migrationListStopReason,
  parseMigrationList,
  productionD1FromConfig,
  shouldGateProductionDeploy,
} from "../apps/web/src/lib/d1-migration-gate.ts";

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
const sourceConfig = parseWranglerJsonc(readFileSync(`${appDir}/wrangler.jsonc`, "utf8"));
// vinext drops ratelimits and new vars from the generated config. Copy them
// from the source config before the preview rewrite below.
copyGoogleSearchWorkerConfig(generatedConfig, sourceConfig);

const isolation = previewIsolationDecision(process.env);
if (isolation === "refuse") {
  console.error(
    "WORKERS_CI is set but WORKERS_CI_BRANCH is empty. Refusing to upload because the production D1 and R2 bindings would be used.",
  );
  process.exit(1);
}

if (isolation === "preview") {
  let secretNames: string[];
  try {
    secretNames = readProductionSecretNames();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  applyPreviewResourceBindings(generatedConfig);
  applyPreviewEnvironment(generatedConfig);
  enforcePreviewSecretBoundary(generatedConfig, secretNames);
  const rootCopy = JSON.parse(
    readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""),
  );
  applyPreviewResourceBindings(rootCopy);
  applyPreviewEnvironment(rootCopy);
  enforcePreviewSecretBoundary(rootCopy, secretNames);
  writeFileSync("wrangler.jsonc", `${JSON.stringify(rootCopy, null, 2)}\n`);
  console.log(
    `Non-main branch ${process.env.WORKERS_CI_BRANCH}: DB ${PREVIEW_D1_NAME} (${PREVIEW_D1_ID}), R2 ${PREVIEW_R2_BUCKET}, ENVIRONMENT=preview`,
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

if (shouldGateProductionDeploy(process.env)) {
  // Check the database this Worker is deployed against: the DB binding in
  // apps/web/wrangler.jsonc (name and id), never a hardcoded name.
  const target = productionD1FromConfig(sourceConfig);
  if (!target.ok) {
    console.error(`Refusing to deploy: ${target.reason}`);
    process.exit(1);
  }
  const { name: dbName, id: dbId } = target;
  const listCommand = `wrangler d1 migrations list ${dbName} --remote`;
  // The root wrangler.jsonc (copied above) has the same DB binding, so wrangler
  // resolves the name to this id.
  const listed = spawnSync("npx", ["wrangler", "d1", "migrations", "list", dbName, "--remote"], {
    encoding: "utf8",
    timeout: MIGRATION_LIST_TIMEOUT_MS,
  });
  const output = `${listed.stdout ?? ""}\n${listed.stderr ?? ""}`;
  const stop = migrationListStopReason(listed);
  if (stop) {
    console.error(output);
    console.error(
      stop === "timeout"
        ? `Refusing to deploy: \`${listCommand}\` timed out. Workers Builds will not run wrangler deploy.`
        : `Refusing to deploy: \`${listCommand}\` failed. Workers Builds will not run wrangler deploy.`,
    );
    process.exit(listed.status && listed.status > 0 ? listed.status : 1);
  }
  const parsed = parseMigrationList(output);
  if (!parsed.ok) {
    console.error(output);
    console.error(`Refusing to deploy: ${parsed.reason}`);
    process.exit(1);
  }
  if (parsed.pending.length > 0) {
    console.error(`Refusing to deploy. ${dbName} (${dbId}) has pending D1 migrations:`);
    for (const name of parsed.pending) console.error(`  ${name}`);
    console.error("Apply those migrations before deploying. This build does not apply them.");
    process.exit(1);
  }
  console.log(`${dbName} (${dbId}) has no pending D1 migrations.`);
}

writeFileSync(generatedConfigPath, `${JSON.stringify(generatedConfig)}\n`);
