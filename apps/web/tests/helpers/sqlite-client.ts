/**
 * A stand-in for the D1 Drizzle client backed by node:sqlite, so repository SQL
 * runs against the real migrations. It supports the `all` and `run` calls the
 * repositories make with `sql` templates, which is everything except batches.
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const dialect = new SQLiteSyncDialect();

export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort())
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  return db;
}

export function sqliteClient(db: DatabaseSync) {
  const prepare = (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query);
    return { statement: db.prepare(sql), params: params as never[] };
  };
  return {
    async all<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
      const { statement, params } = prepare(query);
      return statement.all(...params) as T[];
    },
    async run(query: SQL) {
      const { statement, params } = prepare(query);
      return statement.run(...params);
    },
  } as never;
}
