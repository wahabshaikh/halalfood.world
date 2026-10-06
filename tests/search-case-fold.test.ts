/**
 * QA on 6d6e59a2: "CAFÉ" found 1 place and "café" 30, because SQLite lower()
 * folds only ASCII. Search tries the needle's non-ASCII letters in both
 * cases, so either spelling finds both kinds of stored name.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { searchPlaces } from "@/lib/places";
import { caseVariants, containsText } from "@/lib/text-search";
import { addPlace, boundParameterCounts, createTestDatabase } from "@/lib/testing/sqlite-d1";

function setup(names: string[]) {
  const fixture = createTestDatabase();
  for (const name of names) addPlace(fixture.sqlite, { name, city: "paris", cuisines: [] });
  return fixture;
}

const names = (found: { name: string }[]) => found.map((p) => p.name).sort();

test("café, CAFÉ and Café find the same places", async () => {
  const { db } = setup(["Bon Bouquet Café", "MAZA D‘OR - RESTAURANT & CAFÉ", "Plain Cafe", "Kebab House"]);
  const expected = ["Bon Bouquet Café", "MAZA D‘OR - RESTAURANT & CAFÉ"];
  for (const q of ["café", "CAFÉ", "Café", "cAfÉ"]) assert.deepEqual(names(await searchPlaces(q, { limit: 10 }, db)), expected, q);
  // Accents are not folded yet (v1.1): "cafe" finds only the unaccented name.
  assert.deepEqual(names(await searchPlaces("cafe", { limit: 10 }, db)), ["Plain Cafe"]);
  assert.deepEqual(names(await searchPlaces("KEBAB", { limit: 10 }, db)), ["Kebab House"]);
});

test("Greek, Cyrillic and German names fold too; scripts without case are unchanged", async () => {
  const { db } = setup(["ΤΑΒΕΡΝΑ Ψητοπωλείο", "Шаурма Халяль", "Straße Grill", "مطعم الشام"]);
  assert.deepEqual(names(await searchPlaces("ταβερνα", { limit: 10 }, db)), ["ΤΑΒΕΡΝΑ Ψητοπωλείο"]);
  for (const q of ["ШАУРМА", "шаурма", "Шаурма халяль"]) assert.deepEqual(names(await searchPlaces(q, { limit: 10 }, db)), ["Шаурма Халяль"], q);
  assert.deepEqual(names(await searchPlaces("STRASSE", { limit: 10 }, db)), []);
  assert.deepEqual(names(await searchPlaces("straße", { limit: 10 }, db)), ["Straße Grill"]);
  assert.deepEqual(names(await searchPlaces("الشام", { limit: 10 }, db)), ["مطعم الشام"]);
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

test("the widest search query stays under D1's 100 bound parameters", async () => {
  const { db } = setup(["Café Ταβέρνα"]);
  boundParameterCounts.length = 0;
  const found = await searchPlaces("cAfÉ ταΒέρνα шАурма ÇİĞ ".repeat(3).slice(0, 64), { limit: 50, citySlug: "paris" }, db);
  assert.ok(Array.isArray(found));
  assert.ok(Math.max(...boundParameterCounts) <= 60, String(boundParameterCounts));
});
