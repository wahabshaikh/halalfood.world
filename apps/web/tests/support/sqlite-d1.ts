/**
 * A minimal D1 stand-in on top of node:sqlite, so repository SQL can be run
 * against the real migrations. It implements only what drizzle's D1 driver
 * calls: prepare().bind() with all/run/raw/first, and batch().
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/db/schema";

type Param = string | number | bigint | null | Uint8Array;

class Statement {
  private params: Param[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly text: string,
  ) {}
  bind(...params: unknown[]) {
    this.params = params.map((value) =>
      value === undefined ? null : typeof value === "boolean" ? Number(value) : (value as Param),
    );
    return this;
  }
  private meta() {
    return { changes: 0, last_row_id: 0, duration: 0, served_by: "test" };
  }
  async all() {
    const results = this.db.prepare(this.text).all(...this.params) as Record<string, unknown>[];
    return { results, success: true, meta: this.meta() };
  }
  async run() {
    this.db.prepare(this.text).run(...this.params);
    return { results: [], success: true, meta: this.meta() };
  }
  async first() {
    return (this.db.prepare(this.text).get(...this.params) as unknown) ?? null;
  }
  async raw() {
    const stmt = this.db.prepare(this.text);
    stmt.setReturnArrays?.(true);
    return stmt.all(...this.params) as unknown as unknown[][];
  }
}

export function createTestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = join(import.meta.dirname, "../../migrations");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(join(dir, file), "utf8"));

  const binding = {
    prepare: (text: string) => new Statement(sqlite, text),
    async batch(statements: Statement[]) {
      const out = [];
      for (const statement of statements) out.push(await statement.all());
      return out;
    },
    exec: async (text: string) => sqlite.exec(text),
  };
  return {
    sqlite,
    db: drizzle(binding as unknown as Parameters<typeof drizzle>[0], { schema }),
  };
}

export function addUser(sqlite: DatabaseSync, id: string, name = id) {
  sqlite
    .prepare(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(id, name, `${id}@example.com`, Date.now(), Date.now());
}
