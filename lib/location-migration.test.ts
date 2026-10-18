import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";

test("location migration preserves old pins with protected unknown provenance", () => {
  const sqlite = new DatabaseSync(":memory:");
  const directory = join(import.meta.dirname, "../migrations");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0006").sort())
    sqlite.exec(readFileSync(join(directory, file), "utf8"));
  sqlite.exec("INSERT INTO places (id, name, city_slug, street_address, lat, lng, created_at, updated_at) VALUES ('legacy', 'Cafe', 'london', 'London', 51.5, -0.1, 1, 1)");
  sqlite.exec(readFileSync(join(directory, "0006_place_location_source.sql"), "utf8"));
  const row = sqlite.prepare("SELECT lat, lng, location_source FROM places WHERE id = 'legacy'").get();
  assert.deepEqual({ ...row }, { lat: 51.5, lng: -0.1, location_source: null });
  sqlite.close();
});
