import assert from "node:assert/strict";
import { test } from "vitest";
import { searchPlaces } from "./search-places";
import { searchPlaces as searchSingleWord } from "./places";
import { addPlace, boundParameterCounts, createTestDatabase } from "./testing/sqlite-d1";

const ids = (places: { id: string }[]) => places.map((place) => place.id).sort();

test("city plus dish searches restrict results to the detected city at either end", async () => {
  const { db, sqlite } = createTestDatabase();
  const biryani = addPlace(sqlite, { name: "Rice House", cuisines: ["Biryani"] });
  addPlace(sqlite, { name: "Biryani House", city: "london" });
  addPlace(sqlite, { name: "Kebab House" });
  addPlace(sqlite, { name: "Biryani Closed", status: "closed" });
  for (const q of ["mumbai biryani", "biryani mumbai"]) {
    assert.deepEqual(ids(await searchPlaces(q, { citySlug: "london" }, db)), [biryani]);
  }
});

test("multi-word cities leave all remaining words to match across fields", async () => {
  const { db, sqlite } = createTestDatabase();
  const target = addPlace(sqlite, { name: "The Halal Guys", city: "new-york-city" });
  const kitchen = addPlace(sqlite, { name: "Halal Kitchen", city: "new-york-city" });
  addPlace(sqlite, { name: "The Halal Guys", city: "new-york" });
  assert.deepEqual(ids(await searchPlaces("new york city halal guys", {}, db)), [target]);
  assert.deepEqual(ids(await searchPlaces("new york city", {}, db)), [target, kitchen].sort());
});

test("queries without a city require every word across name, cuisine and address", async () => {
  const { db, sqlite } = createTestDatabase();
  const target = addPlace(sqlite, { name: "The Shop", cuisines: ["Kebab"] });
  const other = addPlace(sqlite, { name: "Kebab Shop" });
  sqlite.prepare("UPDATE places SET address_locality = 'Downtown' WHERE id = ?").run(other);
  addPlace(sqlite, { name: "The Kebab" });
  assert.deepEqual(ids(await searchPlaces("the kebab shop", {}, db)), [target]);
  assert.deepEqual(ids(await searchPlaces("shop kebab bandra road", {}, db)), [target]);
  assert.deepEqual(ids(await searchPlaces("shop kebab bandra road ignored", {}, db)), [target]);
});

test("a city alone returns listed places, and ordinary single-word searches stay unchanged", async () => {
  const { db, sqlite } = createTestDatabase();
  const first = addPlace(sqlite, { name: "Café" });
  const second = addPlace(sqlite, { name: "Kebab House" });
  addPlace(sqlite, { name: "Other", city: "london" });
  addPlace(sqlite, { name: "Hidden", status: "hidden" });
  assert.deepEqual(ids(await searchPlaces("mumbai", {}, db)), [first, second].sort());
  for (const q of ["café", "CAFÉ", "Kebab", "%", "_"]) {
    assert.deepEqual(await searchPlaces(q, { citySlug: "london" }, db), await searchSingleWord(q, { citySlug: "london" }, db));
  }
  assert.deepEqual(await searchPlaces("  ", {}, db), []);
});

test("64-character queries work and four Unicode words remain under D1's parameter budget", async () => {
  const { db, sqlite } = createTestDatabase();
  const long = "a".repeat(57);
  const target = addPlace(sqlite, { name: long });
  assert.deepEqual(ids(await searchPlaces(`mumbai ${long}`, {}, db)), [target]);
  boundParameterCounts.length = 0;
  const unicode = addPlace(sqlite, { name: "cAfÉ ταΒέρνα шАурма ÇİĞ" });
  assert.deepEqual(ids(await searchPlaces("mumbai cAfÉ ταΒέρνα шАурма ÇİĞ", { limit: 50, citySlug: "london" }, db)), [unicode]);
  assert.ok(Math.max(...boundParameterCounts) < 100, String(boundParameterCounts));
});
