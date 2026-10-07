/**
 * Applies D1 migrations to the database Worker Previews bind (`previews.d1_databases` in
 * wrangler.jsonc). Wrangler's `d1 migrations apply` only reads top-level bindings, so this writes a
 * throwaway config with the preview database at the top level and runs Wrangler against it:
 *
 *   pnpm db:migrate:preview            # remote preview database
 *   pnpm db:migrate:preview --dry-run  # print the config and stop
 *
 * All Previews share one database, so a migration applied from a pull request is visible to every
 * other Preview. Migrations are additive (AGENTS.md), which keeps that safe.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

type D1Binding = { binding: string; database_name: string; database_id: string; migrations_dir?: string };

const source = readFileSync("wrangler.jsonc", "utf8");
const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", source);
if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
const config = parsed.config as { account_id?: string; previews?: { d1_databases?: D1Binding[] } };

const database = config.previews?.d1_databases?.find((entry) => entry.binding === "DB");
if (!database) throw new Error("wrangler.jsonc has no previews.d1_databases entry for DB");

const generated = {
  name: "halalfood-world-preview-migrations",
  account_id: config.account_id,
  // Relative to .wrangler/, where this config is written.
  d1_databases: [{ ...database, migrations_dir: `../${database.migrations_dir ?? "migrations"}` }],
};
mkdirSync(".wrangler", { recursive: true });
const path = ".wrangler/preview-migrations.json";
writeFileSync(path, `${JSON.stringify(generated, null, 2)}\n`);

if (process.argv.includes("--dry-run")) {
  console.log(readFileSync(path, "utf8"));
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", path], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
