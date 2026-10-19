import { test } from "vitest";
import assert from "node:assert/strict";
import { leaderboard } from "./community";
import { getEvent, listEvents, parseEventInput, saveEvent, setGoing } from "./events";
import { follow } from "./people";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";

function points(sqlite: ReturnType<typeof createTestDatabase>["sqlite"], userId: string, place: string, value: number, at: number) {
  sqlite
    .prepare(`INSERT INTO points (id, user_id, kind, place_id, city_slug, points, day, created_at) VALUES (?, ?, 'check', ?, 'mumbai', ?, ?, ?)`)
    .run(crypto.randomUUID(), userId, place, value, new Date(at).toISOString().slice(0, 10) + userId + value, at);
}

test("the board ranks by points, hides private and opted-out people, and pins the viewer", async () => {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["amal", "bilal", "carys", "dawud"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id, { handle: id, isPrivate: id === "carys" });
  }
  sqlite.prepare(`UPDATE profiles SET show_on_leaderboards = 0 WHERE user_id = 'dawud'`).run();
  const place = addPlace(sqlite);
  const now = Date.now();
  points(sqlite, "amal", place, 3, now - 1000);
  points(sqlite, "bilal", place, 10, now - 2000);
  points(sqlite, "carys", place, 50, now);
  points(sqlite, "dawud", place, 50, now);
  points(sqlite, "amal", place, 100, now - 30 * DAY);

  const week = await leaderboard("mumbai", "week", "amal", db, now);
  assert.deepEqual(week.rows.map((row) => [row.handle, row.points, row.rank]), [["bilal", 10, 1], ["amal", 3, 2]]);
  assert.equal(week.me?.kind, "row");
  const all = await leaderboard("mumbai", "all", "carys", db, now);
  assert.deepEqual(all.rows.map((row) => row.handle), ["amal", "bilal"]);
  assert.deepEqual(all.me, { kind: "hidden" });
});

function contributionPoints(sqlite: ReturnType<typeof createTestDatabase>["sqlite"], userId: string, place: string, value: number, status: string, at: number, city = "mumbai") {
  const contribution = crypto.randomUUID();
  sqlite
    .prepare(`INSERT INTO contributions (id, user_id, kind, place_id, channel, status, created_at) VALUES (?, ?, 'vouch', ?, 'web', ?, ?)`)
    .run(contribution, userId, place, status === "granted" ? "accepted" : status === "pending" ? "pending" : "rejected", at);
  sqlite
    .prepare(`INSERT INTO contribution_points (id, user_id, contribution_id, kind, place_id, city_slug, points, status, day, created_at) VALUES (?, ?, ?, 'vouch', ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), userId, contribution, place, city, value, status, new Date(at).toISOString().slice(0, 10), at);
}

test("granted contribution points count on the board and add to the old points", async () => {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["amal", "bilal", "carys"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id, { handle: id });
  }
  const place = addPlace(sqlite);
  const now = Date.now();
  points(sqlite, "amal", place, 3, now - 1000);
  contributionPoints(sqlite, "amal", place, 10, "granted", now - 900);
  contributionPoints(sqlite, "bilal", place, 8, "granted", now - 800);
  contributionPoints(sqlite, "carys", place, 2, "granted", now - 700);
  contributionPoints(sqlite, "amal", place, 40, "granted", now - 30 * DAY);
  contributionPoints(sqlite, "carys", place, 50, "granted", now, "london");

  const week = await leaderboard("mumbai", "week", null, db, now);
  assert.deepEqual(week.rows.map((row) => [row.handle, row.points, row.rank]), [["amal", 13, 1], ["bilal", 8, 2], ["carys", 2, 3]]);
  const all = await leaderboard("mumbai", "all", null, db, now);
  assert.deepEqual(all.rows.map((row) => [row.handle, row.points]), [["amal", 53], ["bilal", 8], ["carys", 2]]);
});

test("pending and revoked contribution points never show on the board", async () => {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["amal", "bilal"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id, { handle: id });
  }
  const place = addPlace(sqlite);
  const now = Date.now();
  points(sqlite, "amal", place, 3, now - 1000);
  contributionPoints(sqlite, "amal", place, 20, "pending", now - 900);
  contributionPoints(sqlite, "amal", place, 30, "revoked", now - 800);
  contributionPoints(sqlite, "bilal", place, 15, "pending", now - 700);
  contributionPoints(sqlite, "bilal", place, 25, "revoked", now - 600);

  const all = await leaderboard("mumbai", "all", "bilal", db, now);
  assert.deepEqual(all.rows.map((row) => [row.handle, row.points]), [["amal", 3]]);
  assert.deepEqual(all.me, { kind: "none" });
});

test("events list upcoming published events with stall counts and friends going", async () => {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["amal", "bilal"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id, { handle: id });
  }
  const place = addPlace(sqlite, { name: "Kebab stall" });
  sqlite.prepare(`UPDATE place_status SET status = 'verified', progress = 3 WHERE place_id = ?`).run(place);
  const now = Date.now();
  const input = parseEventInput({
    title: "Eid market",
    venue: "Crawford Market",
    citySlug: "mumbai",
    startsAt: now + DAY,
    status: "published",
    stalls: [{ name: "Kebabs", placeId: place }, { name: "Sweets" }],
  });
  assert.ok(input.ok);
  const id = await saveEvent(null, input.value, "amal", db, now);
  assert.ok(id);
  const draft = parseEventInput({ title: "Secret", venue: "x", citySlug: "mumbai", startsAt: now + DAY });
  assert.ok(draft.ok);
  await saveEvent(null, draft.value, "amal", db, now);

  await follow("amal", "bilal", {}, db);
  await setGoing(id, "bilal", true, db);
  const events = await listEvents({ citySlug: "mumbai", viewerId: "amal", now }, db);
  assert.deepEqual(events.map((event) => event.title), ["Eid market"]);
  assert.equal(events[0].stalls, 2);
  assert.equal(events[0].verifiedStalls, 1);
  assert.deepEqual(events[0].friends.map((friend) => friend.handle), ["bilal"]);
  const detail = await getEvent(id, null, {}, db);
  assert.deepEqual(detail?.stallList.map((stall) => stall.status.kind), ["verified", "unchecked"]);
  assert.equal(parseEventInput({ title: "x", venue: "y", citySlug: "mumbai", startsAt: 10, endsAt: 5 }).ok, false);
});
