import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheck, type CheckInput } from "@/lib/core/check";
import {
  createCheck,
  listPlaceNotes,
  recomputePlaceStatus,
  topDishes,
  CheckPlaceMissing,
} from "@/lib/checks-repository";
import { explorePlaces, getPlaceById, searchPlaces } from "@/lib/places";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";

let keyCounter = 0;
function input(overrides: Record<string, unknown> = {}): CheckInput {
  keyCounter += 1;
  const result = validateCheck({
    owned: "yes",
    certified: "yes",
    pork: "no",
    alcohol: "no",
    idempotencyKey: `key-${String(keyCounter).padStart(8, "0")}`,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["a", "b", "c", "d"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id);
  }
  const place = addPlace(sqlite, { name: "Noor Grill House" });
  return { sqlite, db, place };
}

test("three matching checks from different people verify a place", async () => {
  const { sqlite, db, place } = world();
  let now = Date.now();
  const first = await createCheck("a", place, input(), db, (now += 1000));
  assert.deepEqual(first.recompute?.after, { kind: "checking", progress: 1 });
  await createCheck("b", place, input(), db, (now += 1000));
  const third = await createCheck("c", place, input(), db, (now += 1000));
  assert.deepEqual(third.recompute?.before, { kind: "checking", progress: 2 });
  assert.deepEqual(third.recompute?.after, { kind: "verified" });
  assert.deepEqual(third.recompute?.firstVerifiedBy, ["c", "b", "a"]);

  const status = sqlite.prepare(`SELECT * FROM place_status WHERE place_id = ?`).get(place) as Record<string, unknown>;
  assert.equal(status.status, "verified");
  assert.equal(status.alcohol_value, "no");
  assert.equal(status.eligible_checks, 3);
  assert.ok(status.verified_at);

  const changes = sqlite.prepare(`SELECT from_status, to_status FROM place_status_changes WHERE place_id = ? ORDER BY created_at`).all(place);
  assert.deepEqual(
    changes.map((row) => `${(row as Record<string, unknown>).from_status}>${(row as Record<string, unknown>).to_status}`),
    ["unchecked>checking", "checking>verified"],
  );

  const points = sqlite.prepare(`SELECT user_id, kind, points FROM points ORDER BY user_id, kind`).all() as Record<string, unknown>[];
  assert.equal(points.filter((row) => row.kind === "check").length, 3);
  assert.equal(points.filter((row) => row.kind === "helped-verify").length, 3);
});

test("the same person checking again only counts once, and the request key dedupes", async () => {
  const { db, place } = world();
  const once = input();
  const first = await createCheck("a", place, once, db);
  const repeat = await createCheck("a", place, once, db);
  assert.equal(repeat.deduped, true);
  assert.equal(repeat.checkId, first.checkId);
  const again = await createCheck("a", place, input(), db, Date.now() + 5000);
  assert.deepEqual(again.recompute?.after, { kind: "checking", progress: 1 });
  assert.equal(again.recompute?.derived.eligibleChecks, 1);
});

test("a check from a young account is stored but does not count", async () => {
  const { sqlite, db, place } = world();
  addUser(sqlite, "new", "new", Date.now() - DAY / 2);
  const result = await createCheck("new", place, input(), db);
  assert.equal(result.deduped, false);
  assert.deepEqual(result.recompute?.after, { kind: "unchecked" });
});

test("a newer different answer resets the streak and records a flipped settled fact", async () => {
  const { sqlite, db, place } = world();
  let now = Date.now();
  for (const user of ["a", "b", "c"]) await createCheck(user, place, input(), db, (now += 1000));
  for (const user of ["d", "a", "b"]) await createCheck(user, place, input({ alcohol: "yes" }), db, (now += 1000));
  const status = sqlite.prepare(`SELECT status, alcohol_value, alcohol_streak FROM place_status WHERE place_id = ?`).get(place) as Record<string, unknown>;
  assert.equal(status.alcohol_value, "yes");
  assert.equal(status.alcohol_streak, 3);
  assert.equal(status.status, "verified");
  const flip = sqlite.prepare(`SELECT fact, from_value, to_value FROM place_status_changes WHERE fact IS NOT NULL`).get() as Record<string, unknown>;
  assert.deepEqual({ ...flip }, { fact: "alcohol", from_value: "no", to_value: "yes" });
});

test("excluding checks and recomputing drops the status", async () => {
  const { sqlite, db, place } = world();
  let now = Date.now();
  for (const user of ["a", "b", "c"]) await createCheck(user, place, input(), db, (now += 1000));
  sqlite.prepare(`UPDATE checks SET excluded = 1 WHERE place_id = ?`).run(place);
  const result = await recomputePlaceStatus(place, db, (now += 1000));
  assert.deepEqual(result.after, { kind: "unchecked" });
});

test("unknown places are refused", async () => {
  const { db } = world();
  await assert.rejects(createCheck("a", "3f2504e0-4f89-11d3-9a0c-999999999999", input(), db), CheckPlaceMissing);
});

test("filters and search read the status projection", async () => {
  const { sqlite, db, place } = world();
  const other = addPlace(sqlite, { name: "Harbour Table", cuisines: ["Continental"] });
  let now = Date.now();
  for (const user of ["a", "b", "c"]) await createCheck(user, place, input({ dishes: ["Mutton raan"] }), db, (now += 1000));
  await createCheck("d", other, input({ alcohol: "yes", owned: "no" }), db, (now += 1000));

  const verified = await explorePlaces({ filters: ["verified"] }, db);
  assert.deepEqual(verified.places.map((p) => p.name), ["Noor Grill House"]);
  const noAlcohol = await explorePlaces({ filters: ["no-alcohol"] }, db);
  assert.deepEqual(noAlcohol.places.map((p) => p.name), ["Noor Grill House"]);
  const owned = await explorePlaces({ filters: ["owned"] }, db);
  assert.equal(owned.total, 1);
  const all = await explorePlaces({}, db);
  assert.equal(all.total, 2);
  assert.equal(all.places[0].status.kind, "verified");

  const byDish = await searchPlaces("raan", {}, db);
  assert.deepEqual(byDish.map((p) => p.name), ["Noor Grill House"]);
  assert.deepEqual(await topDishes(place, {}, db), [{ name: "Mutton raan", count: 3 }]);

  const detail = await getPlaceById(place, db);
  assert.equal(detail?.card.facts.pork, "no");
  assert.equal(detail?.card.status.kind, "verified");
});

test("notes respect sharing, privacy and blocks", async () => {
  const { sqlite, db, place } = world();
  addUser(sqlite, "priv");
  addProfile(sqlite, "priv", { isPrivate: true });
  let now = Date.now();
  await createCheck("a", place, input({ note: "Certificate by the till" }), db, (now += 1000));
  await createCheck("b", place, input({ note: "Not shared", shared: false }), db, (now += 1000));
  await createCheck("priv", place, input({ note: "Private account" }), db, (now += 1000));

  const anonymous = await listPlaceNotes(place, null, { limit: 10 }, db);
  assert.deepEqual(anonymous.map((n) => n.note), ["Certificate by the till"]);

  sqlite.prepare(`INSERT INTO follows (follower_id, followee_id, status, created_at, updated_at) VALUES ('c', 'priv', 'accepted', 0, 0)`).run();
  const follower = await listPlaceNotes(place, "c", { limit: 10 }, db);
  assert.deepEqual(follower.map((n) => n.note), ["Private account", "Certificate by the till"]);

  sqlite.prepare(`INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ('a', 'c', 0)`).run();
  const blocked = await listPlaceNotes(place, "c", { limit: 10 }, db);
  assert.deepEqual(blocked.map((n) => n.note), ["Private account"]);
});
