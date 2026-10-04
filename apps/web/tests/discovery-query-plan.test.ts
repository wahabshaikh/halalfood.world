import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";

import { EMPTY_FILTERS } from "@halalfood/core/discovery-filters";
import {
  DiscoveryBboxTooLargeError,
  discoverPlaces,
} from "../src/lib/discovery";
import { createTestDatabase } from "./support/sqlite-d1";

const dialect = new SQLiteSyncDialect();

const BBOX = { west: 72.8, south: 19.0, east: 73.1, north: 19.3 };

async function captureSql(): Promise<string> {
  let text = "";
  const probe = {
    async all(query: SQL) {
      text = dialect.sqlToQuery(query).sql;
      return [];
    },
  };
  await discoverPlaces(
    { filters: EMPTY_FILTERS, bbox: BBOX, limit: 60 },
    probe as never,
  );
  return text;
}

test("a viewport wider than the cap is refused before a query", async () => {
  await assert.rejects(
    () =>
      discoverPlaces(
        {
          filters: EMPTY_FILTERS,
          bbox: { west: -180, south: -90, east: 180, north: 90 },
          limit: 60,
        },
        { async all() { return []; } } as never,
      ),
    DiscoveryBboxTooLargeError,
  );
});

test("the bbox search reads places once through places_public_lat_lng_idx", async () => {
  const { sqlite } = createTestDatabase();
  const insert = sqlite.prepare(
    `INSERT INTO places (
      id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
      scraped_at, created_at, halal_confirmed, listing_status, lat, lng
    ) VALUES (?, ?, 'mumbai', 'u', 'a', '[]', 's', 'u', 1, 1, 1, 'listed', ?, ?)`,
  );
  for (let i = 0; i < 7700; i++) {
    const inView = i < 400;
    const lat = inView ? 19.02 + (i % 20) * 0.01 : -20 + (i % 70) * 0.8;
    const lng = inView ? 72.82 + (i % 25) * 0.01 : -100 + (i % 80) * 2;
    insert.run(`p${i}`, `Place ${i}`, lat, lng);
  }

  const sqlText = await captureSql();
  assert.match(sqlText, /WITH candidates AS MATERIALIZED/);
  const placesSearches = sqlText.split("SEARCH places").length - 1;
  assert.equal(placesSearches, 0, "the SQL text is not an EXPLAIN plan");

  const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sqlText}`).all(
    BBOX.south,
    BBOX.north,
    BBOX.west,
    BBOX.east,
    60,
    0,
  ) as Array<{ detail: string }>;
  const placeAccess = plan.filter((row) => /SCAN places|SEARCH places/.test(row.detail));
  assert.equal(placeAccess.length, 1, plan.map((row) => row.detail).join("\n"));
  assert.match(placeAccess[0].detail, /places_public_lat_lng_idx/);
  assert.equal(plan.filter((row) => row.detail.startsWith("SCAN places")).length, 0);
});
