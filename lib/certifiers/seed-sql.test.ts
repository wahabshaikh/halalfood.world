import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BpjphRawRow } from "./bpjph";
import { buildBpjphSeedSql, sqlString } from "./seed-sql";

const root = join(import.meta.dirname, "../..");
const rows = JSON.parse(readFileSync(join(root, "seed/certifiers/bpjph-lhln-2026-10-17.json"), "utf8")) as BpjphRawRow[];

test("the committed seed migration is exactly what the saved list generates", async () => {
  const committed = readFileSync(join(root, "migrations/0005_certifiers_seed_bpjph.sql"), "utf8");
  assert.equal(await buildBpjphSeedSql(rows), committed, "run: pnpm exec tsx scripts/certifiers-seed-sql.ts");
});

test("the seed holds all 124 bodies and BPJPH only", async () => {
  const text = await buildBpjphSeedSql(rows);
  assert.equal(rows.length, 124);
  assert.equal(text.match(/INSERT OR IGNORE INTO "recognition"/g)?.length, 124);
  assert.doesNotMatch(text, /'jakim'|'moiat'|'gac'/);
});

test("two bodies that would share a slug stop the build", async () => {
  await assert.rejects(buildBpjphSeedSql([rows[0], { ...rows[0], lph_id: "OTHER" }]), /Duplicate slug/);
});

test("SQL strings double their quotes", () => {
  assert.equal(sqlString("O'Brien"), "'O''Brien'");
  assert.equal(sqlString(null), "NULL");
  assert.equal(sqlString(5), "5");
});
