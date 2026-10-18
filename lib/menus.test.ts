import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { showsMenuBadge } from "@/lib/core/menus";
import { createTestDatabase } from "@/lib/testing/sqlite-d1";
import { getPlaceMenu } from "./menus";
import { getPlaceById } from "./places";

const BIRYANI = "00000000-0000-4000-8000-000000000002";
const SHAWARMA = "00000000-0000-4000-8000-000000000003";
const KEBAB = "00000000-0000-4000-8000-000000000004";
const MIGRATIONS = join(import.meta.dirname, "../migrations");

test("the seed has a clean menu with a logo, a flagged check and a no_menu check", async () => {
  const { sqlite, db } = createTestDatabase();
  const seed = readFileSync(join(import.meta.dirname, "../seed/local.sql"), "utf8");
  sqlite.exec(seed);
  // INSERT OR IGNORE and guarded UPDATEs: loading it twice changes nothing.
  sqlite.exec(seed);

  const biryani = await getPlaceMenu(BIRYANI, db);
  assert.equal(biryani.menu?.itemCount, 14);
  assert.deepEqual(biryani.menu?.sections.map((section) => section.section), ["Starters", "Biryani", "Grills", "Breads", "Drinks"]);
  assert.equal(biryani.menu?.sections[1]?.items[0]?.price, "£14.50");
  assert.equal(biryani.menu?.sources.length, 2);
  assert.equal(showsMenuBadge(biryani.check), true);
  assert.equal((await getPlaceById(BIRYANI, db))?.card.logoUrl, "https://halalfood.world/icon-512.png");

  const shawarma = await getPlaceMenu(SHAWARMA, db);
  assert.equal(shawarma.check?.status, "flagged");
  assert.deepEqual(shawarma.check?.flags, [{ itemName: "Lager (bottle)", reason: "alcohol", note: null }]);
  assert.equal(showsMenuBadge(shawarma.check), false);
  assert.deepEqual((await getPlaceById(SHAWARMA, db))?.web_sources.alcohol, { url: "https://example.com/seed-shawarma-bar/menu", certifier: null });

  const kebab = await getPlaceMenu(KEBAB, db);
  assert.deepEqual([kebab.menu, kebab.check?.status, showsMenuBadge(kebab.check)], [null, "no_menu", false]);
});

test("the 0008 rollback drops only what 0008 added, and 0008 applies again after it", () => {
  const { sqlite } = createTestDatabase();
  const tables = () => (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'place_menu%' ORDER BY name`).all() as { name: string }[]).map((row) => row.name);
  const placeColumns = () => (sqlite.prepare(`PRAGMA table_info(places)`).all() as { name: string }[]).map((row) => row.name);
  assert.deepEqual(tables(), ["place_menu_check_flags", "place_menu_checks", "place_menu_items", "place_menu_sources", "place_menus"]);
  const before = placeColumns();
  assert.ok(before.includes("logo_url") && before.includes("logo_source_url"));
  sqlite.prepare(`INSERT INTO places (id, name, city_slug, street_address, created_at, updated_at) VALUES ('p1', 'Cafe', 'london', 'London', 1, 1)`).run();
  sqlite.prepare(`INSERT INTO place_claims (id, place_id, source, fact, value, source_url, created_at, updated_at) VALUES ('c1', 'p1', 'scout', 'alcohol', 'yes', 'https://example.com', 1, 1)`).run();

  sqlite.exec(readFileSync(join(MIGRATIONS, "rollback/0008_menus.down.sql"), "utf8"));
  assert.deepEqual(tables(), []);
  assert.deepEqual(placeColumns(), before.filter((name) => name !== "logo_url" && name !== "logo_source_url"));
  // Earlier tables and rows are untouched.
  assert.ok(sqlite.prepare(`SELECT 1 FROM place_claims WHERE id = 'c1'`).get());

  sqlite.exec(readFileSync(join(MIGRATIONS, "0008_menus.sql"), "utf8"));
  assert.equal(tables().length, 5);
  assert.deepEqual(placeColumns(), before);
});
