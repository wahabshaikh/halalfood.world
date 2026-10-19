import assert from "node:assert/strict";
import { test } from "vitest";
import { recomputePlaceStatus } from "@/lib/checks-repository";
import { MAX_MENU_ITEMS } from "@/lib/core/menus";
import { getPlaceMenu } from "@/lib/menus";
import { explorePlaces, getPlaceById } from "@/lib/places";
import { addPlace, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { MAX_BATCH } from "./batch";
import type { ScoutDeps } from "./deps";
import type { WriteLimiter } from "./limits";
import { handleScoutRequest, type ScoutEnvironment } from "./mcp";
import { TOOL_NAMES } from "./tools";

const SECRET = "scout-test-secret-0123456789abcdef-xyz";
const ORIGIN = "https://halalfood.world";
const NOW = Date.parse("2026-10-18T12:00:00Z");
const MENU_PAGE = "https://www.example-biryani.co.uk/menu";
const LOGO = "https://www.example-biryani.co.uk/logo.png";

function setup(overrides: Partial<ScoutEnvironment> = {}) {
  const test = createTestDatabase();
  let now = NOW;
  const deps: ScoutDeps = { db: test.db, origin: ORIGIN, now: () => now };
  const environment: ScoutEnvironment = { secret: SECRET, deps: async () => deps, ...overrides };
  const place = addPlace(test.sqlite, { name: "Biryani House", city: "london", lat: 51.52, lng: -0.07 });
  return { ...test, deps, environment, place, tick: (ms: number) => (now += ms) };
}
type Setup = ReturnType<typeof setup>;

async function call(environment: ScoutEnvironment, name: string, args: unknown) {
  const response = await handleScoutRequest(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
    environment,
  );
  const text = await response.text();
  const line = text.split("\n").find((entry) => entry.startsWith("data: "));
  const body = JSON.parse(line ? line.slice(6) : text) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { message: string } };
  const out = body.result?.content[0]?.text ?? body.error?.message ?? "";
  return { isError: Boolean(body.result?.isError ?? body.error), text: out, body: out.startsWith("{") ? JSON.parse(out) : null };
}

const count = (s: Setup, sql: string, ...params: string[]) => Number((s.sqlite.prepare(sql).get(...params) as { n: number }).n);
const statusOf = (s: Setup, id: string) => s.sqlite.prepare(`SELECT * FROM place_status WHERE place_id = ?`).get(id) as Record<string, unknown>;

const menu = (placeId: string, over: Record<string, unknown> = {}) => ({
  place_id: placeId,
  currency: "GBP",
  captured_at: "2026-10-10",
  sources: [
    { url: MENU_PAGE, type: "website" },
    { url: "https://deliveroo.co.uk/menu/london/biryani-house", type: "deliveroo" },
  ],
  items: [
    { name: "Samosa (2)", price: 4.5, section: "Starters", description: "Potato and pea" },
    { name: "Lamb biryani", price: 14.5, section: "Biryani" },
    { name: "Chicken biryani", price: 12.95, section: "Biryani" },
    { name: "Mango lassi", price: 3.95, section: "Drinks" },
  ],
  ...over,
});

function addCheck(s: Setup, userId: string, placeId: string, answers: Partial<Record<"owned" | "certified" | "pork" | "alcohol", string>>) {
  addUser(s.sqlite, userId, userId, NOW - 30 * DAY);
  const { owned = null, certified = null, pork = null, alcohol = null } = answers;
  s.sqlite
    .prepare(`INSERT INTO checks (id, user_id, place_id, owned, certified, pork, alcohol, shared, excluded, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`)
    .run(crypto.randomUUID(), userId, placeId, owned, certified, pork, alcohol, crypto.randomUUID(), NOW - DAY);
}

/* ------------------------------------------------------------------ menus */

test("the menu tools are listed", () => {
  for (const name of ["upsert_menu", "upsert_menus", "set_menu_check", "set_menu_checks", "set_place_logo"]) assert.ok((TOOL_NAMES as readonly string[]).includes(name), name);
});

test("upsert_menu stores a menu, a repeat is unchanged, and a new one replaces items and sources as a whole", async () => {
  const s = setup();
  const created = await call(s.environment, "upsert_menu", menu(s.place));
  assert.equal(created.isError, false, created.text);
  assert.deepEqual(created.body, {
    ok: true,
    result: "created",
    place_id: s.place,
    place_url: `${ORIGIN}/place/${s.place}`,
    items: 4,
    sections: 3,
    sources: 2,
    captured_at: "2026-10-10T00:00:00.000Z",
  });

  // The same menu again changes nothing; a newer read date moves captured_at forward, an older one doesn't.
  const again = await call(s.environment, "upsert_menu", menu(s.place, { captured_at: "2026-10-12" }));
  assert.equal(again.body.result, "unchanged");
  assert.equal(again.body.captured_at, "2026-10-12T00:00:00.000Z");
  const older = await call(s.environment, "upsert_menu", menu(s.place, { captured_at: "2026-10-01" }));
  assert.equal(older.body.captured_at, "2026-10-12T00:00:00.000Z");
  const ids = s.sqlite.prepare(`SELECT id FROM place_menu_items WHERE place_id = ? ORDER BY position`).all(s.place);

  const replaced = await call(
    s.environment,
    "upsert_menu",
    menu(s.place, { sources: [{ url: "https://www.zomato.com/london/biryani-house/menu", type: "zomato" }], items: [{ name: "Nihari", price: 13, section: "Mains", currency: "GBP" }] }),
  );
  assert.equal(replaced.body.result, "updated");
  assert.equal(count(s, `SELECT count(*) AS n FROM place_menu_items WHERE place_id = ?`, s.place), 1);
  assert.equal(count(s, `SELECT count(*) AS n FROM place_menu_sources WHERE place_id = ?`, s.place), 1);
  assert.equal(count(s, `SELECT count(*) AS n FROM place_menus`), 1);
  assert.notDeepEqual(s.sqlite.prepare(`SELECT id FROM place_menu_items WHERE place_id = ?`).all(s.place), ids);

  // A menu is context: nothing about the place's halal status moved.
  assert.deepEqual([statusOf(s, s.place).status, statusOf(s, s.place).alcohol_value, statusOf(s, s.place).pork_value], ["unchecked", null, null]);
  assert.equal(count(s, `SELECT count(*) AS n FROM place_claims`), 0);
});

test("the place page's menu groups by section with formatted prices, sources and the read date", async () => {
  const s = setup();
  await call(s.environment, "upsert_menu", menu(s.place, { items: [...menu(s.place).items, { name: "Masala chai", price: 250, currency: "INR", section: "Drinks" }] }));
  const { menu: read, check } = await getPlaceMenu(s.place, s.db);
  assert.equal(check, null);
  assert.ok(read);
  assert.equal(read.capturedAt, Date.parse("2026-10-10T00:00:00Z"));
  assert.equal(read.itemCount, 5);
  assert.deepEqual(
    read.sections.map((section) => [section.section, section.items.map((item) => `${item.name} ${item.price}`)]),
    [
      ["Starters", ["Samosa (2) £4.50"]],
      ["Biryani", ["Lamb biryani £14.50", "Chicken biryani £12.95"]],
      ["Drinks", ["Mango lassi £3.95", "Masala chai ₹250.00"]],
    ],
  );
  assert.deepEqual(read.sources, [
    { url: MENU_PAGE, type: "website" },
    { url: "https://deliveroo.co.uk/menu/london/biryani-house", type: "deliveroo" },
  ]);
  assert.deepEqual(await getPlaceMenu(addPlace(s.sqlite), s.db), { menu: null, check: null });
});

test("upsert_menu validates prices, currencies, https sources and size at the boundary", async () => {
  const s = setup();
  const item = { name: "Lamb biryani", price: 14.5 };
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ items: [{ ...item, price: -1 }] }, /price/],
    [{ currency: "gbp" }, /ISO 4217/],
    [{ currency: "XXQ" }, /ISO 4217/],
    [{ currency: undefined, items: [item] }, /currency on the menu or on every item/],
    [{ items: [{ ...item, currency: "POUNDS" }] }, /ISO 4217/],
    [{ sources: [{ url: "http://www.example-biryani.co.uk/menu", type: "website" }] }, /https URL \(http is refused\)/],
    [{ sources: [{ url: MENU_PAGE, type: "justeat" }] }, /sources/],
    [{ sources: [] }, /sources/],
    [{ items: [] }, /items/],
    [{ items: Array.from({ length: MAX_MENU_ITEMS + 1 }, (_, i) => ({ ...item, name: `Dish ${i}` })) }, /items/],
    [{ captured_at: "2027-01-01" }, /future/],
  ];
  for (const [over, message] of cases) {
    const out = await call(s.environment, "upsert_menu", menu(s.place, over));
    assert.equal(out.isError, true, JSON.stringify(over).slice(0, 120));
    assert.match(out.text, message, JSON.stringify(over).slice(0, 120));
  }
  assert.equal(count(s, `SELECT count(*) AS n FROM place_menus`), 0);
  // 500 items is the cap, not over it; they go in under D1's 100 bound parameters per statement.
  const full = await call(s.environment, "upsert_menu", menu(s.place, { items: Array.from({ length: MAX_MENU_ITEMS }, (_, i) => ({ ...item, name: `Dish ${i}`, section: `S${i % 7}` })) }));
  assert.equal(full.body?.result, "created", full.text);
  assert.equal(count(s, `SELECT count(*) AS n FROM place_menu_items`), MAX_MENU_ITEMS);
});

test("menus resolve their place like the other tools: valid id, listed, not alcohol-led", async () => {
  const s = setup();
  const hidden = addPlace(s.sqlite, { name: "Old Grill", status: "hidden" });
  const pub = addPlace(s.sqlite, { name: "The Kings Arms Pub" });
  const error = async (placeId: string, tool = "upsert_menu") => (await call(s.environment, tool, tool === "upsert_menu" ? menu(placeId) : { place_id: placeId, status: "clean" })).body?.error;
  assert.equal(await error("not-a-place-id"), "invalid_place_id");
  assert.equal(await error("3f2504e0-4f89-11d3-9a0c-999999999999"), "place_not_found");
  assert.equal(await error(hidden), "place_not_listed");
  assert.equal(await error(pub), "rejected");
  assert.equal(await error(hidden, "set_menu_check"), "place_not_listed");
  assert.equal((await call(s.environment, "set_place_logo", { place_id: pub, logo_url: LOGO, source_url: MENU_PAGE })).body?.error, "rejected");
});

test("upsert_menus reports each item, refuses over 25 and spends one write per menu", async () => {
  let left = 2;
  const limiter: WriteLimiter = { async limit() { return { success: left-- > 0 }; } };
  const s = setup({ limiter });
  const other = addPlace(s.sqlite, { name: "Kebab Hut", city: "london" });
  const batch = await call(s.environment, "upsert_menus", { menus: [menu(s.place), menu("3f2504e0-4f89-11d3-9a0c-999999999999"), menu(other)] });
  assert.deepEqual(
    batch.body.results.map((r: { index: number; result?: string; error?: string }) => [r.index, r.result ?? r.error]),
    [
      [0, "created"],
      [1, "place_not_found"],
      [2, "rate_limited"],
    ],
  );
  assert.deepEqual(batch.body.summary, { failed: 2, created: 1 });
  // An item that fails the schema refuses the whole batch before anything runs, as for every batch tool.
  assert.equal((await call(s.environment, "upsert_menus", { menus: [menu(other, { currency: "ZZZ" })] })).isError, true);
  const tooMany = await call(s.environment, "upsert_menus", { menus: Array.from({ length: MAX_BATCH + 1 }, () => menu(s.place)) });
  assert.equal(tooMany.isError, true);
});

/* ------------------------------------------------------------ menu checks */

test("a clean menu check shows the badge and nothing else: no claims, no facts, no status change", async () => {
  const s = setup();
  await call(s.environment, "upsert_menu", menu(s.place));
  const before = statusOf(s, s.place);
  const clean = await call(s.environment, "set_menu_check", { place_id: s.place, status: "clean", checked_at: "2026-10-11" });
  assert.deepEqual(clean.body, { ok: true, result: "created", place_id: s.place, place_url: `${ORIGIN}/place/${s.place}`, status: "clean", flags: 0, claims: {}, badge: true });
  assert.deepEqual(statusOf(s, s.place), before);
  assert.equal(count(s, `SELECT count(*) AS n FROM place_claims`), 0);
  const read = await getPlaceMenu(s.place, s.db);
  assert.deepEqual(read.check, { status: "clean", checkedAt: Date.parse("2026-10-11T00:00:00Z"), sourceUrl: MENU_PAGE, flags: [] });
  // Filters never pick a place up from a clean check.
  assert.equal((await explorePlaces({ citySlug: "london", filters: ["no-alcohol"] }, s.db)).total, 0);
  assert.equal((await explorePlaces({ citySlug: "london", filters: ["no-pork"] }, s.db)).total, 0);
  assert.equal((await call(s.environment, "set_menu_check", { place_id: s.place, status: "clean", checked_at: "2026-10-11" })).body.result, "unchanged");
});

test("a flagged check writes Scout claims alcohol = yes / pork = yes citing the menu; reason other writes none", async () => {
  const s = setup();
  await call(s.environment, "upsert_menu", menu(s.place, { items: [...menu(s.place).items, { name: "Lager (bottle)", price: 5, section: "Drinks" }] }));
  const flagged = await call(s.environment, "set_menu_check", {
    place_id: s.place,
    status: "flagged",
    flags: [
      { item: "lager (bottle)", reason: "alcohol" },
      { name: "Pork belly special", reason: "pork", note: "On the specials board photo" },
      { name: "Gelatine dessert", reason: "other" },
    ],
  });
  assert.equal(flagged.isError, false, flagged.text);
  assert.deepEqual([flagged.body.result, flagged.body.flags, flagged.body.badge], ["created", 3, false]);
  assert.deepEqual(flagged.body.claims, { alcohol: "set", pork: "set" });
  const claims = s.sqlite.prepare(`SELECT fact, value, source, source_url FROM place_claims WHERE place_id = ? ORDER BY fact`).all(s.place).map((row) => ({ ...row }));
  assert.deepEqual(claims, [
    { fact: "alcohol", value: "yes", source: "scout", source_url: MENU_PAGE },
    { fact: "pork", value: "yes", source: "scout", source_url: MENU_PAGE },
  ]);
  const status = statusOf(s, s.place);
  // The claims fill the facts but settle nothing and leave the place Not checked yet.
  assert.deepEqual([status.status, status.alcohol_value, status.alcohol_sources, status.alcohol_settled, status.pork_value], ["unchecked", "yes", "scout", null, "yes"]);
  assert.deepEqual((await getPlaceById(s.place, s.db))?.web_sources.alcohol, { url: MENU_PAGE, certifier: null });
  // The flag on a menu item links to it, and the link goes when the menu is replaced; the name stays.
  const flagRow = () => ({ ...(s.sqlite.prepare(`SELECT item_id, item_name FROM place_menu_check_flags WHERE place_id = ? AND position = 0`).get(s.place) as object) });
  const linked = flagRow() as { item_id: string | null; item_name: string };
  assert.ok(linked.item_id);
  assert.equal(linked.item_name, "Lager (bottle)");
  await call(s.environment, "upsert_menu", menu(s.place));
  assert.deepEqual(flagRow(), { item_id: null, item_name: "Lager (bottle)" });
  assert.equal((await getPlaceMenu(s.place, s.db)).check?.flags.length, 3);

  const other = addPlace(s.sqlite, { name: "Gelato Bar Uno" });
  const otherOnly = await call(s.environment, "set_menu_check", { place_id: other, status: "flagged", flags: [{ name: "Gelatine dessert", reason: "other" }] });
  assert.deepEqual(otherOnly.body.claims, {});
  assert.equal(count(s, `SELECT count(*) AS n FROM place_claims WHERE place_id = ?`, other), 0);
});

test("a flagged check never overrides community checks or approved documents, and replaces Scout's older claim", async () => {
  const s = setup();
  await call(s.environment, "upsert_menu", menu(s.place));
  addCheck(s, "u1", s.place, { alcohol: "no" });
  await recomputePlaceStatus(s.place, s.db, NOW);
  // An earlier Scout claim (from upsert_place) that pork is not served.
  s.sqlite
    .prepare(`INSERT INTO place_claims (id, place_id, source, fact, value, source_url, created_at, updated_at) VALUES (?, ?, 'scout', 'pork', 'no', 'https://old.example.com', 1, 1)`)
    .run(crypto.randomUUID(), s.place);
  await recomputePlaceStatus(s.place, s.db, NOW);
  const out = await call(s.environment, "set_menu_check", {
    place_id: s.place,
    status: "flagged",
    flags: [
      { name: "Beer list", reason: "alcohol" },
      { name: "Pepperoni pizza", reason: "pork" },
    ],
  });
  assert.deepEqual(out.body.claims, { alcohol: "kept_existing", pork: "updated" });
  const status = statusOf(s, s.place);
  assert.deepEqual([status.alcohol_value, status.alcohol_sources], ["no", "community"]);
  assert.deepEqual([status.pork_value, status.pork_sources], ["yes", "scout"]);
  assert.equal(count(s, `SELECT count(*) AS n FROM place_claims WHERE fact = 'alcohol'`), 0);
  assert.equal(count(s, `SELECT count(*) AS n FROM place_claims WHERE fact = 'pork' AND source_url = ?`, MENU_PAGE), 1);

  // A clean check later leaves the flagged check's claims alone: it never clears or writes a fact.
  const clean = await call(s.environment, "set_menu_check", { place_id: s.place, status: "clean" });
  assert.deepEqual([clean.body.result, clean.body.claims], ["updated", {}]);
  assert.equal(statusOf(s, s.place).pork_value, "yes");
  assert.equal(count(s, `SELECT count(*) AS n FROM place_menu_check_flags`), 0);
});

test("menu check inputs: flags exactly when flagged, items on the stored menu, a source to cite", async () => {
  const s = setup();
  const error = async (args: Record<string, unknown>) => {
    const out = await call(s.environment, "set_menu_check", { place_id: s.place, ...args });
    assert.equal(out.isError, true, JSON.stringify(args));
    return out.body?.error ?? out.text;
  };
  assert.match(await error({ status: "flagged" }), /at least one flag/);
  assert.match(await error({ status: "clean", flags: [{ name: "Beer", reason: "alcohol" }] }), /at least one flag/);
  assert.match(await error({ status: "halal" }), /status/);
  assert.match(await error({ status: "flagged", flags: [{ item: "Beer", name: "Beer", reason: "alcohol" }] }), /item or name, not both/);
  assert.match(await error({ status: "flagged", flags: [{ name: "Beer", reason: "gluten" }] }), /reason/);
  assert.match(await error({ status: "clean", source_url: "http://example.com/menu" }), /https URL/);
  // No menu stored yet: an item reference can't match, and an alcohol flag has nothing to cite.
  assert.equal(await error({ status: "flagged", flags: [{ item: "Lager", reason: "alcohol" }] }), "unknown_item");
  assert.equal(await error({ status: "flagged", flags: [{ name: "Lager", reason: "alcohol" }] }), "missing_source");
  // An explicit source works without a stored menu.
  const cited = await call(s.environment, "set_menu_check", { place_id: s.place, status: "flagged", source_url: "https://example.com/drinks", flags: [{ name: "Lager", reason: "alcohol" }] });
  assert.deepEqual(cited.body.claims, { alcohol: "set" });
  // no_menu records that Scout looked, and nothing else.
  const none = await call(s.environment, "set_menu_check", { place_id: s.place, status: "no_menu" });
  assert.deepEqual([none.body.result, none.body.badge, none.body.claims], ["updated", false, {}]);
  assert.equal(statusOf(s, s.place).alcohol_value, "yes");
});

test("set_menu_checks runs a batch in order", async () => {
  const s = setup();
  const other = addPlace(s.sqlite, { name: "Kebab Hut" });
  const out = await call(s.environment, "set_menu_checks", {
    checks: [
      { place_id: s.place, status: "clean" },
      { place_id: other, status: "no_menu" },
      { place_id: "nope", status: "clean" },
    ],
  });
  assert.deepEqual(
    out.body.results.map((r: { result?: string; error?: string; status?: string }) => r.error ?? `${r.result}:${r.status}`),
    ["created:clean", "created:no_menu", "invalid_place_id"],
  );
});

/* ------------------------------------------------------------------ logos */

test("set_place_logo stores an https logo that cards and the page read, and clears it with null", async () => {
  const s = setup();
  const set = await call(s.environment, "set_place_logo", { place_id: s.place, logo_url: LOGO, source_url: "https://www.example-biryani.co.uk/" });
  assert.deepEqual(set.body, { ok: true, result: "set", place_id: s.place, logo_url: LOGO });
  assert.equal((await call(s.environment, "set_place_logo", { place_id: s.place, logo_url: LOGO, source_url: "https://www.example-biryani.co.uk/" })).body.result, "unchanged");
  const row = s.sqlite.prepare(`SELECT logo_url, logo_source_url FROM places WHERE id = ?`).get(s.place);
  assert.deepEqual({ ...(row as object) }, { logo_url: LOGO, logo_source_url: "https://www.example-biryani.co.uk/" });
  assert.equal((await getPlaceById(s.place, s.db))?.card.logoUrl, LOGO);
  const listed = await explorePlaces({ citySlug: "london" }, s.db);
  assert.equal(listed.places.find((place) => place.id === s.place)?.logoUrl, LOGO);

  const moved = await call(s.environment, "set_place_logo", { place_id: s.place, logo_url: `${LOGO}?v=2`, source_url: "https://www.example-biryani.co.uk/" });
  assert.equal(moved.body.result, "updated");
  const cleared = await call(s.environment, "set_place_logo", { place_id: s.place, logo_url: null });
  assert.deepEqual(cleared.body, { ok: true, result: "cleared", place_id: s.place, logo_url: null });
  assert.equal((await getPlaceById(s.place, s.db))?.card.logoUrl, null);
  assert.equal((await call(s.environment, "set_place_logo", { place_id: s.place, logo_url: null })).body.result, "unchanged");
  // Status is untouched throughout.
  assert.equal(statusOf(s, s.place).status, "unchecked");
});

test("logos must be https, with the page they came from; the database refuses anything else too", async () => {
  const s = setup();
  const http = await call(s.environment, "set_place_logo", { place_id: s.place, logo_url: "http://www.example-biryani.co.uk/logo.png", source_url: MENU_PAGE });
  assert.equal(http.isError, true);
  assert.match(http.text, /https URL \(http is refused\)/);
  const noSource = await call(s.environment, "set_place_logo", { place_id: s.place, logo_url: LOGO });
  assert.match(noSource.text, /source_url/);
  const script = await call(s.environment, "set_place_logo", { place_id: s.place, logo_url: "javascript:alert(1)", source_url: MENU_PAGE });
  assert.equal(script.isError, true);
  assert.throws(() => s.sqlite.prepare(`UPDATE places SET logo_url = 'http://example.com/logo.png' WHERE id = ?`).run(s.place), /CHECK constraint/);
  // A row that somehow holds a bad URL never renders it.
  s.sqlite.exec(`PRAGMA ignore_check_constraints = ON`);
  s.sqlite.prepare(`UPDATE places SET logo_url = 'javascript:alert(1)' WHERE id = ?`).run(s.place);
  assert.equal((await getPlaceById(s.place, s.db))?.card.logoUrl, null);
});
