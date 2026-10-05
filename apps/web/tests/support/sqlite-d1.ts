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

export const D1_MAX_BOUND_PARAMETERS = 100;
/** The parameter count of every statement bound, for budget tests. */
export const boundParameterCounts: number[] = [];

type Param = string | number | bigint | null | Uint8Array;

class Statement {
  private params: Param[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly text: string,
  ) {}
  bind(...params: unknown[]) {
    // D1 allows at most 100 bound parameters per query.
    boundParameterCounts.push(params.length);
    if (params.length > D1_MAX_BOUND_PARAMETERS)
      throw new Error(`D1_ERROR: too many SQL variables (${params.length})`);
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

/** A user whose account is old enough for checks to count, unless `createdAt` says otherwise. */
export function addUser(sqlite: DatabaseSync, id: string, name = id, createdAt = Date.now() - 30 * DAY) {
  sqlite
    .prepare(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(id, name, `${id}@example.com`, createdAt, createdAt);
}

export const DAY = 24 * 60 * 60 * 1000;

let placeCounter = 0;

/** A listed place with an unchecked status row. */
export function addPlace(
  sqlite: DatabaseSync,
  overrides: Partial<{ id: string; name: string; city: string; lat: number | null; lng: number | null; googlePlaceId: string | null; cuisines: string[]; status: string }> = {},
) {
  placeCounter += 1;
  const id = overrides.id ?? `3f2504e0-4f89-11d3-9a0c-${String(placeCounter).padStart(12, "0")}`;
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO places (id, name, city_slug, street_address, address_locality, serves_cuisine, lat, lng, google_place_id, listing_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      overrides.name ?? `Place ${placeCounter}`,
      overrides.city ?? "mumbai",
      `${placeCounter} Main Road, Mumbai`,
      "Bandra West",
      JSON.stringify(overrides.cuisines ?? ["Mughlai"]),
      overrides.lat === undefined ? 19.06 : overrides.lat,
      overrides.lng === undefined ? 72.83 : overrides.lng,
      overrides.googlePlaceId ?? null,
      overrides.status ?? "listed",
      now,
      now,
    );
  sqlite
    .prepare(`INSERT INTO place_status (place_id, status, progress, eligible_checks, updated_at) VALUES (?, 'unchecked', 0, 0, ?)`)
    .run(id, now);
  return id;
}

export function addProfile(
  sqlite: DatabaseSync,
  userId: string,
  overrides: Partial<{ handle: string; name: string; isPrivate: boolean; onboarded: boolean }> = {},
) {
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO profiles (user_id, handle, display_name, is_private, onboarded_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, overrides.handle ?? userId, overrides.name ?? userId, overrides.isPrivate ? 1 : 0, overrides.onboarded === false ? null : now, now, now);
}
