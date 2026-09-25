import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-ignore -- node:sqlite is built into the Node 22 runtime used by the project.
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("map bounds query uses the partial coordinate index", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(resolve("migrations/0002_places.sql"), "utf8"));
    db.exec(
      readFileSync(resolve("migrations/0009_places_map_bounds_index.sql"), "utf8"),
    );

    const plan = db
      .prepare(`
        EXPLAIN QUERY PLAN
        SELECT id, name, city_slug, street_address, address_locality,
          address_country, telephone, website, rating_value, review_count,
          lat, lng, count(*) OVER() AS total
        FROM places
        WHERE halal_confirmed = 1
          AND lat IS NOT NULL
          AND lng IS NOT NULL
          AND lat BETWEEN ? AND ?
          AND lng BETWEEN ? AND ?
        ORDER BY CAST(rating_value AS REAL) DESC NULLS LAST,
          review_count DESC NULLS LAST, id
        LIMIT ?
      `)
      .all(-35, -33, 150, 152, 600);

    const details = plan.map((row) => String(row.detail)).join("\n");
    assert.match(details, /SEARCH places USING INDEX places_map_bounds_idx/);
  } finally {
    db.close();
  }
});
