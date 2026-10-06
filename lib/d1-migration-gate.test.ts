import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MIGRATION_LIST_TIMEOUT_MS,
  migrationListStopReason,
  parseMigrationList,
  shouldGateProductionDeploy,
} from "./d1-migration-gate";

test("only the Workers Builds production branch gates deploy", () => {
  assert.equal(shouldGateProductionDeploy({}), false);
  assert.equal(shouldGateProductionDeploy({ WORKERS_CI: "1" }), false);
  assert.equal(
    shouldGateProductionDeploy({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "cursor/example" }),
    false,
  );
  assert.equal(
    shouldGateProductionDeploy({ WORKERS_CI: "1", WORKERS_CI_BRANCH: " main " }),
    true,
  );
});

test("a clear migration list is not pending", () => {
  const parsed = parseMigrationList("🌀 Migrations\n✅ No migrations to apply!\n");
  assert.deepEqual(parsed, { ok: true, pending: [] });
});

test("pending migration names are the sql files in the table", () => {
  const output = `
Migrations to be applied:
┌─────────────────────────────────┐
│ Name                            │
├─────────────────────────────────┤
│ 0018_visit_idempotency.sql      │
│ 0020_listing_visibility.sql     │
└─────────────────────────────────┘
`;
  const parsed = parseMigrationList(output);
  assert.deepEqual(parsed, {
    ok: true,
    pending: ["0018_visit_idempotency.sql", "0020_listing_visibility.sql"],
  });
});

test("a timed-out migration list fails closed", () => {
  assert.equal(MIGRATION_LIST_TIMEOUT_MS > 0, true);
  assert.equal(
    migrationListStopReason({ status: null, error: { code: "ETIMEDOUT" } }),
    "timeout",
  );
  assert.equal(migrationListStopReason({ status: 1 }), "failed");
  assert.equal(migrationListStopReason({ status: 0 }), null);
});

test("an unreadable migration list fails closed", () => {
  const parsed = parseMigrationList("Authentication error");
  assert.equal(parsed.ok, false);
});

test("the gate checks the DB binding named in wrangler.jsonc", async () => {
  const { productionD1FromConfig } = await import("./d1-migration-gate");
  const { readFileSync } = await import("node:fs");
  const { parseWranglerJsonc, PRODUCTION_D1_ID, PRODUCTION_D1_NAME, ROLLBACK_D1_ID } = await import(
    "./preview-bindings"
  );
  const config = parseWranglerJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const target = productionD1FromConfig(config);
  assert.deepEqual(target, { ok: true, name: PRODUCTION_D1_NAME, id: PRODUCTION_D1_ID });
  assert.deepEqual(target, { ok: true, name: "halalfood-world-v2", id: "889b19af-2870-45b4-b6ee-92c3686010f0" });
  assert.notEqual(PRODUCTION_D1_ID, ROLLBACK_D1_ID);
  // Missing or placeholder bindings stop the deploy instead of checking some other database.
  assert.equal(productionD1FromConfig({}).ok, false);
  assert.equal(productionD1FromConfig({ d1_databases: [{ binding: "DB", database_name: "halalfood-world-v2", database_id: "REPLACE_WITH_V2_ID" }] }).ok, false);
  assert.equal(productionD1FromConfig({ d1_databases: [{ binding: "OTHER", database_name: "x", database_id: PRODUCTION_D1_ID }] }).ok, false);
  const stage = readFileSync(new URL("../../../scripts/stage-cloudflare-build.ts", import.meta.url), "utf8");
  assert.doesNotMatch(stage, /"migrations", "list", "halalfood-world"/);
  assert.match(stage, /productionD1FromConfig\(sourceConfig\)/);
});
