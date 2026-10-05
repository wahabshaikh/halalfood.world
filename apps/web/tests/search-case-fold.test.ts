/**
 * QA on 6d6e59a2: "CAFÉ" found 1 place and "café" 30, because SQLite lower()
 * folds only ASCII. Search now tries the needle's non-ASCII letters in both
 * cases, so either spelling finds both kinds of stored name.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_FILTERS } from "@halalfood/core/discovery-filters";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { resetListingVersionMemo } from "../src/lib/listing-cache";
import { discoverPlaces } from "../src/lib/discovery";
import { findPlaces } from "../src/lib/places";
import { clearReadCache } from "../src/lib/read-cache";
import { caseVariants, containsText } from "../src/lib/text-search";
import { boundParameterCounts, createTestDatabase } from "./support/sqlite-d1";

function setup(names: string[]) {
  clearReadCache();
  resetListingVersionMemo();
  const fixture = createTestDatabase();
  const insert = fixture.sqlite.prepare(
    `INSERT INTO places (
      id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
      scraped_at, created_at, halal_confirmed, listing_status, lat, lng
    ) VALUES (?, ?, 'paris', '/city/paris', '1 Rue', '[]', 's', 'https://example.com', 1, 1, 1, 'listed', 48.85, 2.35)`,
  );
  names.forEach((name, i) => insert.run(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name));
  return fixture;
}

const names = (found: { places: { name: string }[] }) => found.places.map((p) => p.name).sort();

test("café, CAFÉ and Café find the same places", async () => {
  const { db } = setup(["Bon Bouquet Café", "MAZA D‘OR - RESTAURANT & CAFÉ", "Plain Cafe", "Kebab House"]);
  const expected = ["Bon Bouquet Café", "MAZA D‘OR - RESTAURANT & CAFÉ"];
  for (const q of ["café", "CAFÉ", "Café", "cAfÉ"]) assert.deepEqual(names(await findPlaces({ q, limit: 10 }, db)), expected, q);
  // Accents are not folded yet (v1.1): "cafe" finds only the unaccented name.
  assert.deepEqual(names(await findPlaces({ q: "cafe", limit: 10 }, db)), ["Plain Cafe"]);
  assert.deepEqual(names(await findPlaces({ q: "KEBAB", limit: 10 }, db)), ["Kebab House"]);
});

test("Greek, Cyrillic and German names fold too; scripts without case are unchanged", async () => {
  const { db } = setup(["ΤΑΒΕΡΝΑ Ψητοπωλείο", "Шаурма Халяль", "Straße Grill", "مطعم الشام"]);
  assert.deepEqual(names(await findPlaces({ q: "ταβερνα", limit: 10 }, db)), ["ΤΑΒΕΡΝΑ Ψητοπωλείο"]);
  for (const q of ["ШАУРМА", "шаурма", "Шаурма халяль"])
    assert.deepEqual(names(await findPlaces({ q, limit: 10 }, db)), ["Шаурма Халяль"], q);
  assert.deepEqual(names(await findPlaces({ q: "STRASSE", limit: 10 }, db)), []);
  assert.deepEqual(names(await findPlaces({ q: "straße", limit: 10 }, db)), ["Straße Grill"]);
  assert.deepEqual(names(await findPlaces({ q: "الشام", limit: 10 }, db)), ["مطعم الشام"]);
});

test("an ASCII query keeps the single instr() from #86; others try at most 4 spellings", () => {
  assert.deepEqual(caseVariants("Kebab House"), ["kebab house"]);
  assert.deepEqual(caseVariants("CAFÉ"), ["café", "cafÉ"]);
  assert.deepEqual(caseVariants("مطعم"), ["مطعم"]);
  // A letter whose other case changes length stays as typed.
  assert.deepEqual(caseVariants("ß"), ["ß"]);
  assert.ok(caseVariants("İstanbul Döner").every((v) => Array.from(v).length === 14));
  assert.ok(caseVariants("cAfÉ ŞiŞ").length <= 4);
  const dialect = new SQLiteSyncDialect();
  assert.equal(dialect.sqlToQuery(containsText(sql`name`, "Kebab")).sql, "instr(lower(name), ?) > 0");
  assert.equal(
    dialect.sqlToQuery(containsText(sql`name`, "CAFÉ")).sql,
    "(instr(lower(name), ?) > 0 OR instr(lower(name), ?) > 0)",
  );
});

test("polish: /search's Add button wraps and the toast Dismiss is 44x44", async () => {
  const page = readFileSync(new URL("../app/search/page.tsx", import.meta.url), "utf8");
  assert.match(page, /className=\{ADD_QUERY_BUTTON\}/);
  assert.match(page, /ADD_QUERY_BUTTON = `[^`]*whitespace-normal[^`]*max-w-full|ADD_QUERY_BUTTON = `[^`]*max-w-full[^`]*whitespace-normal/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  const { TOAST_DISMISS_TAP_TARGET } = await import("../src/lib/map-loading");
  // 22 px inside the 1 px border + 11 px each side = 44 px.
  assert.match(TOAST_DISMISS_TAP_TARGET, /after:-inset-\[11px\]/);
  assert.match(TOAST_DISMISS_TAP_TARGET, /\brelative\b/);
  const view = readFileSync(new URL("../app/map/map-view.tsx", import.meta.url), "utf8");
  assert.match(view, /className=\{TOAST_DISMISS_TAP_TARGET\}/);
});

test("the widest discovery query stays under D1's 100 bound parameters", async () => {
  const { db } = setup(["Café Ταβέρνα"]);
  const params = new URLSearchParams({
    q: "cAfÉ ταΒέρνα шАурма ÇİĞ ".repeat(3).slice(0, 64),
    dish: "döner şiş ΣΟΥΒΛΑΚΙ",
    cuisine: Array.from({ length: 25 }, (_, i) => `türk${i}é`).join(","),
    status: "verified,community-verified,halal-options,self-declared,unverified,not-halal",
    facts: "noAlcohol,noPork,dedicatedKitchen,muslimOwned,prayerSpace,womenFriendly,vegetarian,certified",
    price: "1,2,3,4",
    service: "dine-in,takeaway,delivery,drive-through",
    meal: "breakfast,lunch,dinner,late-night",
    open: "1",
    within: "5",
  });
  const { parseDiscoveryFilters } = await import("@halalfood/core/discovery-filters");
  const filters = parseDiscoveryFilters(params);
  assert.equal(filters.cuisines.length, 20);
  assert.equal(filters.statuses.length + filters.serviceTypes.length + filters.meals.length, 14);
  boundParameterCounts.length = 0;
  const found = await discoverPlaces(
    { filters, bbox: { west: 2.2, south: 48.7, east: 2.5, north: 48.9 }, origin: { lat: 48.8, lng: 2.3 }, limit: 60, offset: 0 },
    db,
  );
  assert.ok(Array.isArray(found.places));
  // 76 on 92e152d; folding adds 7 (q and dish spellings), leaving headroom.
  assert.ok(Math.max(...boundParameterCounts) <= 85, String(boundParameterCounts));
});

test("map search folds case too and still searches every text column", async () => {
  const { db } = setup(["Bon Bouquet Café", "Kebab House"]);
  const find = async (q: string) =>
    (await discoverPlaces({ filters: { ...EMPTY_FILTERS, q }, limit: 10 }, db)).places.map((p) => p.name).sort();
  assert.deepEqual(await find("CAFÉ"), ["Bon Bouquet Café"]);
  assert.deepEqual(await find("café"), ["Bon Bouquet Café"]);
  assert.deepEqual(await find("KEBAB"), ["Kebab House"]);
  assert.deepEqual(await find("1 rue"), ["Bon Bouquet Café", "Kebab House"]);
  assert.deepEqual(await find("PARIS"), ["Bon Bouquet Café", "Kebab House"]);
  // Columns are joined by U+001F, so a match cannot run from name into city.
  assert.deepEqual(await find("house paris"), []);
});
