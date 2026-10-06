import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPlacesForCaption } from "@/lib/media-match-repository";
import { createTestDatabase } from "@/lib/testing/sqlite-d1";

function insertPlace(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
  id: string,
  name: string,
  listed = 1,
) {
  sqlite
    .prepare(
      `INSERT INTO places (id, name, city_slug, street_address, address_locality, serves_cuisine, listing_status, created_at, updated_at)
       VALUES (?, ?, 'mumbai', 'Crawford Market', 'Mumbai', '[]', ?, 1, 1)`,
    )
    .run(id, name, listed ? "listed" : "hidden");
}

test("a caption finds the listed place it names", async () => {
  const { sqlite, db } = createTestDatabase();
  insertPlace(sqlite, "p1", "Zaffran Grill");
  insertPlace(sqlite, "p2", "Irani Chai Corner");
  insertPlace(sqlite, "p3", "Zaffran Palace Unlisted", 0);
  const matches = await matchPlacesForCaption(
    "Crawford Market's smokiest seekh at Zaffran Grill in Mumbai 🔥",
    db,
  );
  assert.deepEqual(matches.map((match) => match.id), ["p1"]);
  assert.equal(matches[0].streetAddress, "Crawford Market");
  assert.equal(matches[0].confidence, "high");
});

test("nothing matches an empty, generic or unrelated caption", async () => {
  const { sqlite, db } = createTestDatabase();
  insertPlace(sqlite, "p1", "Zaffran Grill");
  assert.deepEqual(await matchPlacesForCaption("", db), []);
  assert.deepEqual(await matchPlacesForCaption("the best halal food ever", db), []);
  assert.deepEqual(await matchPlacesForCaption("100% pure %_ wildcard", db), []);
  assert.deepEqual(await matchPlacesForCaption("dinner at a place in london", db), []);
});
