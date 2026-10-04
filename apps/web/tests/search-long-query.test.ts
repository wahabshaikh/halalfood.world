/**
 * QA on e9eee7bf: GET /api/places/search returned 503 for any query of 49+
 * characters. Root cause: D1 caps LIKE patterns at 50 bytes
 * (SQLITE_LIMIT_LIKE_PATTERN_LENGTH), and `'%' || q || '%'` is q + 2 bytes.
 * D1 then throws "LIKE or GLOB pattern too complex", and the route answered 503.
 *
 * These tests give node:sqlite the same limit: `like()` is replaced by one
 * that throws past 50 bytes, as D1 does. Every free-text search must then
 * still answer for 48, 49, 64 and 200 characters and for multibyte text.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EMPTY_FILTERS } from "@halalfood/core/discovery-filters";
import { GET } from "../app/api/places/search/route";
import { discoverPlaces } from "../src/lib/discovery";
import { resetListingVersionMemo } from "../src/lib/listing-cache";
import { createList, searchLists } from "../src/lib/lists-repository";
import { matchPlacesForCaption } from "../src/lib/media-match-repository";
import { findPlaces } from "../src/lib/places";
import { clearReadCache } from "../src/lib/read-cache";
import { normalizeSearchQuery, SEARCH_QUERY_MAX_CHARS } from "../src/lib/search-query";
import { searchPeople } from "../src/lib/social-repository";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const D1_LIKE_PATTERN_BYTES = 50;
const LONG_NAME = "The Extremely Long Named Halal Grill House and Family Dining Room of Leyton";
const MULTIBYTE_NAME = "مطعم الشام للمشويات الحلال والمأكولات الشرقية الأصيلة";

function d1Like(pattern: unknown, value: unknown, escape?: unknown) {
  const text = String(pattern ?? "");
  if (Buffer.byteLength(text, "utf8") > D1_LIKE_PATTERN_BYTES)
    throw new Error("LIKE or GLOB pattern too complex: SQLITE_ERROR");
  const esc = typeof escape === "string" ? escape : null;
  let source = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (esc && char === esc && i + 1 < text.length) source += text[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (char === "%") source += "[\\s\\S]*";
    else if (char === "_") source += "[\\s\\S]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  if (value === null || value === undefined) return null;
  return new RegExp(`^${source}$`, "i").test(String(value)) ? 1 : 0;
}

function setup() {
  clearReadCache();
  resetListingVersionMemo();
  const fixture = createTestDatabase();
  fixture.sqlite.function("like", { deterministic: true, varargs: true }, d1Like as never);
  const insert = fixture.sqlite.prepare(
    `INSERT INTO places (
      id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
      scraped_at, created_at, halal_confirmed, listing_status, lat, lng
    ) VALUES (?, ?, 'london', '/city/london', '1 High Street', '["grill"]', 's', 'https://example.com', 1, 1, 1, 'listed', 51.5, -0.1)`,
  );
  insert.run("11111111-1111-4111-8111-111111111111", LONG_NAME);
  insert.run("22222222-2222-4222-8222-222222222222", MULTIBYTE_NAME);
  insert.run("33333333-3333-4333-8333-333333333333", "100% Halal_Cafe");
  return fixture;
}

const ascii = (n: number) => LONG_NAME.slice(0, n);

test("the emulated D1 limit is real: a 51-byte LIKE pattern throws", () => {
  const { sqlite } = setup();
  const q = "x".repeat(49);
  assert.throws(
    () => sqlite.prepare("SELECT count(*) FROM places WHERE name LIKE ?").get(`%${q}%`),
    /pattern too complex/,
  );
  assert.doesNotThrow(() =>
    sqlite.prepare("SELECT count(*) FROM places WHERE name LIKE ?").get(`%${"x".repeat(48)}%`),
  );
});

for (const length of [48, 49, 64, 200]) {
  test(`place search answers for a ${length}-character query`, async () => {
    const { db } = setup();
    const q = length <= LONG_NAME.length ? ascii(length) : (LONG_NAME + " ").repeat(4).slice(0, length);
    const found = await findPlaces({ q, limit: 10 }, db);
    // Past 64 characters only the first 64 are searched, so the place whose
    // name starts that way is still found.
    assert.deepEqual(found.places.map((p) => p.name), [LONG_NAME]);
  });
}

test("a query is capped at 64 characters, and the first 64 still find the place", async () => {
  const { db } = setup();
  assert.equal(SEARCH_QUERY_MAX_CHARS, 64);
  const capped = normalizeSearchQuery("  " + ascii(70) + "  ");
  assert.equal(Array.from(capped).length, 64);
  assert.equal(capped, ascii(64).trimEnd());
  const found = await findPlaces({ q: ascii(70), limit: 10 }, db);
  assert.deepEqual(found.places.map((p) => p.name), [LONG_NAME]);
});

test("multibyte queries: the limit is bytes, so 30 Arabic characters are already past 50", async () => {
  const { db } = setup();
  for (const n of [10, 25, 30, 52]) {
    const q = Array.from(MULTIBYTE_NAME).slice(0, n).join("");
    if (n >= 30) assert.ok(Buffer.byteLength(`%${q}%`) > 50, `n=${n} bytes`);
    const found = await findPlaces({ q, limit: 10 }, db);
    assert.deepEqual(found.places.map((p) => p.name), [MULTIBYTE_NAME], `n=${n}`);
  }
  const emoji = "🍕".repeat(40); // 160 bytes
  assert.equal((await findPlaces({ q: emoji, limit: 10 }, db)).places.length, 0);
  assert.equal(Array.from(normalizeSearchQuery("🍕".repeat(100))).length, 64);
});

test("% and _ are plain characters, as the escaped LIKE treated them", async () => {
  const { db } = setup();
  assert.deepEqual((await findPlaces({ q: "100% halal_", limit: 10 }, db)).places.map((p) => p.name), [
    "100% Halal_Cafe",
  ]);
  assert.equal((await findPlaces({ q: "100%_", limit: 10 }, db)).places.length, 0);
  // ASCII case folds, as LIKE did.
  assert.equal((await findPlaces({ q: ascii(60).toUpperCase(), limit: 10 }, db)).places.length, 1);
});

test("discovery, people, lists and caption matching take long text too", async () => {
  const { sqlite, db } = setup();
  addUser(sqlite, "owner");
  sqlite
    .prepare(
      `INSERT INTO user_profiles (user_id, handle, display_name, created_at, updated_at, onboarded_at)
       VALUES ('owner', 'owner-handle', ?, 1, 1, 1)`,
    )
    .run("Someone With A Remarkably Long Display Name For Testing Purposes");
  const long = "z".repeat(200);
  const discovered = await discoverPlaces(
    { filters: { ...EMPTY_FILTERS, q: ascii(60), dish: long, cuisines: [long] }, limit: 10 },
    db,
  );
  assert.equal(discovered.places.length, 0);
  const byName = await discoverPlaces({ filters: { ...EMPTY_FILTERS, q: ascii(60) }, limit: 10 }, db);
  assert.equal(byName.places.length, 1);
  assert.equal((await searchPeople("Someone With A Remarkably Long Display Name For Testing", null, 20, db)).length, 1);
  assert.equal((await searchPeople(long, null, 20, db)).length, 0);
  assert.deepEqual(await searchLists(long, null, 20, db), []);
  const slug = "a-very-long-list-title-that-becomes-a-very-long-slug-past-fifty-bytes";
  const list = await createList("owner", { title: "T", slug, description: null, ranked: true, visibility: "public", caption: null } as never, db);
  const again = await createList("owner", { title: "T", slug, description: null, ranked: true, visibility: "public", caption: null } as never, db);
  assert.equal(list.slug, slug);
  assert.equal(again.slug, `${slug}-2`);
  await matchPlacesForCaption(`${LONG_NAME} ${long} #halal`, db);
});

test("the API never answers a long or multibyte query with a 5xx for its length", async () => {
  // Length is never a 400 now; only fewer than 2 characters is.
  const short = await GET(new Request("https://halalfood.world/api/places/search?q=a"));
  assert.equal(short.status, 400);
  const source = readFileSync(new URL("../app/api/places/search/route.ts", import.meta.url), "utf8");
  assert.match(source, /normalizeSearchQuery\(params\.get\("q"\)/);
  assert.doesNotMatch(source, /120/);
  assert.match(source, /domainFailure\("Search", error\)/);
});

test("no free-text search builds a LIKE pattern from user input", () => {
  for (const file of [
    "src/lib/places.ts",
    "src/lib/discovery.ts",
    "src/lib/lists-repository.ts",
    "src/lib/social-repository.ts",
    "src/lib/media-match-repository.ts",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const likes = source.match(/LIKE \$\{[^}]*\}/g) ?? [];
    // Only the enumerated service/meal filters remain: fixed, short values.
    for (const like of likes) assert.match(like, /service|meal/, `${file}: ${like}`);
  }
});

test("/add caps its background local lookup, and /search says what failed", () => {
  const add = readFileSync(new URL("../app/add/add-place-form.tsx", import.meta.url), "utf8");
  assert.match(add, /encodeURIComponent\(normalizeSearchQuery\(term\)\)/);
  const page = readFileSync(new URL("../app/search/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /Search is taking a moment/);
  assert.match(page, /SEARCH_FAILED_TITLE/);
});
