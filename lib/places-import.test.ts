import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { seedStatements, toSeedPlace } from "../scripts/places-seed";
import { addPlace, createTestDatabase } from "./testing/sqlite-d1";

test("seed imports mark coordinates as import without trusting exported provenance", () => {
  const { sqlite } = createTestDatabase();
  for (const lat of [51.5, null]) {
    const place = toSeedPlace({ id: crypto.randomUUID(), name: `Cafe ${lat}`, city_slug: "london", street_address: "7 High St", lat, lng: lat === null ? null : -0.1, location_source: "scout" });
    assert.ok(place);
    for (const statement of seedStatements([place])) sqlite.prepare(statement.sql).run(...statement.params as (string | number | null)[]);
    const row = sqlite.prepare("SELECT location_source FROM places WHERE id = ?").get(String(place.id)) as { location_source: string | null };
    assert.equal(row.location_source, lat === null ? null : "import");
  }
});

test("candidate SQL finds repeated city pins and single city-only addresses without mutating", () => {
  const { sqlite } = createTestDatabase();
  const shared = [addPlace(sqlite, { name: "Cafe One", city: "london" }), addPlace(sqlite, { name: "Cafe Two", city: "london" })];
  const city = addPlace(sqlite, { name: "Cafe Three", city: "paris", lat: 48.85, lng: 2.35 });
  sqlite.prepare("UPDATE places SET street_address = 'Paris' WHERE id = ?").run(city);
  const normal = addPlace(sqlite, { name: "Cafe Four", city: "london", lat: 51.5, lng: -0.1 });
  sqlite.prepare("UPDATE places SET street_address = '7 High Street' WHERE id = ?").run(normal);
  const query = readFileSync(join(import.meta.dirname, "../scripts/scout-city-pins.sql"), "utf8");
  const rows = sqlite.prepare(query).all() as { id: string; scout_creation_audit: number }[];
  assert.deepEqual(new Set(rows.map((row) => row.id)), new Set([...shared, city]));
  assert.ok(rows.every((row) => row.scout_creation_audit === 0));
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM places").get() as { n: number }).n, 4);
});
