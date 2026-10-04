import assert from "node:assert/strict";
import test from "node:test";

import {
  MIGRATION_LIST_TIMEOUT_MS,
  migrationListStopReason,
  parseMigrationList,
  shouldGateProductionDeploy,
} from "../src/lib/d1-migration-gate";

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
