/**
 * Write migrations/0005_certifiers_seed_bpjph.sql from the saved BPJPH list.
 *
 *   pnpm exec tsx scripts/certifiers-seed-sql.ts
 *
 * The migration is committed; lib/certifiers/seed-sql.test.ts checks it still matches the JSON.
 * Never edit a migration that is already on main: a new list goes through the daily check, not a reseed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BpjphRawRow } from "@/lib/certifiers/bpjph";
import { buildBpjphSeedSql, SEED_FILE } from "@/lib/certifiers/seed-sql";

const root = join(import.meta.dirname, "..");
const rows = JSON.parse(readFileSync(join(root, SEED_FILE), "utf8")) as BpjphRawRow[];
const target = join(root, "migrations/0005_certifiers_seed_bpjph.sql");
writeFileSync(target, await buildBpjphSeedSql(rows));
console.log(`Wrote ${target} (${rows.length} certifiers)`);
