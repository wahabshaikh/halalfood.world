import { test } from "vitest";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { pointDay } from "@/lib/core/points";
import { listPendingPlaces, memberTier, placeAddStatements, reviewPlaceAdd } from "@/lib/contributions";
import { runBatch } from "@/lib/checks-repository";
import { DAY, addPlace, addProfile, addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";

const NOW = Date.now();

/** A New-tier member's place waiting on review, with the adder's own check on it. */
async function pendingWorld() {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "newbie", "newbie", NOW - 3 * DAY);
  addProfile(sqlite, "newbie");
  addUser(sqlite, "mod");
  sqlite.prepare(`INSERT INTO moderators (user_id, created_at) VALUES ('mod', ?)`).run(NOW);
  const placeId = addPlace(sqlite, { status: "hidden" });
  await runBatch(db, placeAddStatements("newbie", placeId, "mumbai", "new", true, NOW - DAY));
  sqlite
    .prepare(`INSERT INTO points (id, user_id, kind, place_id, city_slug, points, day, created_at) VALUES ('pt', 'newbie', 'check', ?, 'mumbai', 3, ?, ?)`)
    .run(placeId, pointDay(NOW - DAY), NOW - DAY);
  return { sqlite, db, placeId };
}

function row(sqlite: DatabaseSync, query: string, ...params: string[]) {
  return { ...(sqlite.prepare(query).get(...params) as Record<string, unknown>) };
}

test("tiers come from the account and its contributions", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "fresh", "fresh", NOW - 60 * 60 * 1000);
  addUser(sqlite, "newbie", "newbie", NOW - 3 * DAY);
  addUser(sqlite, "mod", "mod", NOW - 60 * 60 * 1000);
  sqlite.prepare(`INSERT INTO moderators (user_id, created_at) VALUES ('mod', ?)`).run(NOW);
  addUser(sqlite, "regular", "regular", NOW - 10 * DAY);
  const places = [addPlace(sqlite), addPlace(sqlite)];
  for (const [index, placeId] of [places[0], places[1], places[1]].entries())
    sqlite
      .prepare(`INSERT INTO contributions (id, user_id, kind, place_id, channel, status, created_at) VALUES (?, 'regular', 'vouch', ?, 'web', 'accepted', ?)`)
      .run(`c${index}`, placeId, NOW);
  assert.equal(await memberTier("fresh", db, NOW), "restricted");
  assert.equal(await memberTier("newbie", db, NOW), "new");
  assert.equal(await memberTier("mod", db, NOW), "moderator");
  assert.equal(await memberTier("regular", db, NOW), "member");
  assert.equal(await memberTier("gone", db, NOW), "restricted");
});

test("pending places are listed for moderators", async () => {
  const { db, placeId } = await pendingWorld();
  const [place] = await listPendingPlaces(db);
  assert.equal(place.placeId, placeId);
  assert.equal(place.submittedBy, "newbie");
});

test("approving lists the place, accepts the add and grants its 5 points", async () => {
  const { sqlite, db, placeId } = await pendingWorld();
  const result = await reviewPlaceAdd(placeId, "mod", "approve", null, db, NOW);
  assert.deepEqual(result, { ok: true, points: 5 });
  assert.equal(row(sqlite, `SELECT listing_status FROM places WHERE id = ?`, placeId).listing_status, "listed");
  assert.deepEqual(row(sqlite, `SELECT status, reviewed_by FROM contributions WHERE place_id = ?`, placeId), { status: "accepted", reviewed_by: "mod" });
  assert.deepEqual(row(sqlite, `SELECT points, status, day FROM contribution_points WHERE place_id = ?`, placeId), {
    points: 5,
    status: "granted",
    day: pointDay(NOW),
  });
  assert.equal(row(sqlite, `SELECT actor_user_id FROM audit_log WHERE action = 'approve-place' AND target_id = ?`, placeId).actor_user_id, "mod");
  assert.deepEqual(await listPendingPlaces(db), []);
  assert.deepEqual(await reviewPlaceAdd(placeId, "mod", "reject", "late", db, NOW), {
    ok: false,
    status: 404,
    error: "That place isn’t waiting for review.",
  });
});

test("approval respects the 100-point day cap", async () => {
  const { sqlite, db, placeId } = await pendingWorld();
  const other = addPlace(sqlite);
  sqlite.prepare(`INSERT INTO contributions (id, user_id, kind, place_id, channel, status, created_at) VALUES ('old', 'newbie', 'video', ?, 'web', 'accepted', ?)`).run(other, NOW);
  sqlite
    .prepare(`INSERT INTO contribution_points (id, user_id, contribution_id, kind, place_id, city_slug, points, status, day, created_at)
      VALUES ('earned', 'newbie', 'old', 'video', ?, 'mumbai', 98, 'granted', ?, ?)`)
    .run(other, pointDay(NOW), NOW);
  assert.deepEqual(await reviewPlaceAdd(placeId, "mod", "approve", null, db, NOW), { ok: true, points: 2 });
});

test("rejecting keeps it hidden, records the reason, revokes the points and excludes the adder's answers", async () => {
  const { sqlite, db, placeId } = await pendingWorld();
  sqlite
    .prepare(`INSERT INTO checks (id, user_id, place_id, owned, certified, pork, alcohol, idempotency_key, created_at)
      VALUES ('chk', 'newbie', ?, 'yes', NULL, 'no', 'no', 'key-0000000001', ?)`)
    .run(placeId, NOW - DAY);
  const result = await reviewPlaceAdd(placeId, "mod", "reject", "Not a restaurant", db, NOW);
  assert.deepEqual(result, { ok: true, points: 0 });
  assert.equal(row(sqlite, `SELECT listing_status FROM places WHERE id = ?`, placeId).listing_status, "hidden");
  assert.deepEqual(row(sqlite, `SELECT status, reason FROM contributions WHERE place_id = ?`, placeId), { status: "rejected", reason: "Not a restaurant" });
  assert.equal(row(sqlite, `SELECT status FROM contribution_points WHERE place_id = ?`, placeId).status, "revoked");
  assert.equal(row(sqlite, `SELECT excluded FROM checks WHERE id = 'chk'`).excluded, 1);
  assert.equal(row(sqlite, `SELECT count(*) AS n FROM points WHERE user_id = 'newbie'`).n, 0);
  assert.equal(row(sqlite, `SELECT reason FROM audit_log WHERE action = 'reject-place' AND target_id = ?`, placeId).reason, "Not a restaurant");
});
