import assert from "node:assert/strict";
import test from "node:test";

import { annotateCardEvidence } from "../src/lib/discovery";
import { createTestDatabase } from "./support/sqlite-d1";

test("card evidence loads a list in one query", async () => {
  const { sqlite, db } = createTestDatabase();
  const insert = sqlite.prepare(
    `INSERT INTO places (
      id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
      scraped_at, created_at, halal_confirmed, listing_status, lat, lng
    ) VALUES (?, ?, 'mumbai', 'u', 'a', '[]', 's', 'u', 1, 1, 1, 'listed', 19.1, 72.9)`,
  );
  const places = Array.from({ length: 12 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    insert.run(id, `Place ${index}`);
    return { id, name: `Place ${index}` };
  });

  let queries = 0;
  const counting = db as unknown as { all: (query: unknown) => Promise<unknown[]> };
  const original = counting.all.bind(db);
  counting.all = async (query) => {
    queries += 1;
    return original(query);
  };

  const annotated = await annotateCardEvidence(places, db);
  assert.equal(queries, 1);
  assert.equal(annotated.length, 12);
  assert.equal(annotated.every((place) => place.evidence_loaded), true);
});
