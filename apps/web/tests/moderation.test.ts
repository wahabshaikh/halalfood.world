import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheck } from "@halalfood/core/check";
import { createCheck } from "../src/lib/checks-repository";
import { actOnReport, listOpenReports } from "../src/lib/moderation";
import { getPlaceById } from "../src/lib/places";
import { addPlace, addProfile, addUser, createTestDatabase } from "./support/sqlite-d1";

let n = 0;
function input() {
  n += 1;
  const result = validateCheck({ owned: "yes", certified: "yes", pork: "no", alcohol: "no", idempotencyKey: `mod-key-${String(n).padStart(6, "0")}` });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function report(sqlite: ReturnType<typeof createTestDatabase>["sqlite"], targetType: string, targetId: string, reason: string) {
  const id = crypto.randomUUID();
  sqlite
    .prepare(`INSERT INTO reports (id, target_type, target_id, reporter_id, reason, status, created_at, updated_at) VALUES (?, ?, ?, 'mod', ?, 'open', ?, ?)`)
    .run(id, targetType, targetId, reason, Date.now(), Date.now());
  return id;
}

async function verified() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["mod", "a", "b", "c"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id, { handle: id === "mod" ? "moderator1" : `user_${id}` });
  }
  sqlite.prepare(`INSERT INTO moderators (user_id, created_at) VALUES ('mod', 1)`).run();
  const place = addPlace(sqlite, { name: "Noor Grill" });
  let now = Date.now() - 10_000;
  const checks: string[] = [];
  for (const id of ["a", "b", "c"]) checks.push((await createCheck(id, place, input(), db, (now += 1000))).checkId);
  assert.equal((await getPlaceById(place, db))?.card.status.kind, "verified");
  return { sqlite, db, place, checks };
}

test("reset checks excludes every check so far and the place goes back to unchecked", async () => {
  const { sqlite, db, place } = await verified();
  const id = report(sqlite, "place", place, "wrong-answers");
  const queue = await listOpenReports(db);
  assert.equal(queue[0].primary, "reset-checks");
  assert.equal(queue[0].target.title, "Noor Grill");
  assert.deepEqual(await actOnReport(id, "mod", { action: "reset-checks" }, db), { ok: true });
  assert.equal((await getPlaceById(place, db))?.card.status.kind, "unchecked");
  assert.equal((sqlite.prepare(`SELECT count(*) AS n FROM points WHERE kind = 'check'`).get() as { n: number }).n, 0);
  assert.equal((sqlite.prepare(`SELECT count(*) AS n FROM audit_log`).get() as { n: number }).n, 1);
  assert.equal((await actOnReport(id, "mod", { action: "dismiss" }, db)).ok, false, "a handled report stays handled");
});

test("excluding one check drops the place out of verified", async () => {
  const { sqlite, db, place, checks } = await verified();
  const id = report(sqlite, "check", checks[0], "spam");
  assert.deepEqual(await actOnReport(id, "mod", { action: "exclude-check" }, db), { ok: true });
  assert.deepEqual((await getPlaceById(place, db))?.card.status, { kind: "checking", progress: 2 });
});

test("suspending a person stops their checks counting", async () => {
  const { sqlite, db, place } = await verified();
  const id = report(sqlite, "user", "a", "harassment");
  assert.deepEqual(await actOnReport(id, "mod", { action: "suspend-user" }, db), { ok: true });
  assert.deepEqual((await getPlaceById(place, db))?.card.status, { kind: "checking", progress: 2 });
});

test("merging moves checks into the kept place and deletes the duplicate", async () => {
  const { sqlite, db, place } = await verified();
  const keep = addPlace(sqlite, { name: "Noor Grill House" });
  sqlite.prepare(`INSERT INTO saved_places (user_id, place_id, created_at) VALUES ('a', ?, 1)`).run(place);
  const id = report(sqlite, "place", place, "duplicate");
  assert.deepEqual(await actOnReport(id, "mod", { action: "merge", intoPlaceId: keep }, db), { ok: true });
  assert.equal(await getPlaceById(place, db), null);
  assert.equal((await getPlaceById(keep, db))?.card.status.kind, "verified");
  assert.ok(sqlite.prepare(`SELECT 1 FROM saved_places WHERE user_id = 'a' AND place_id = ?`).get(keep));
});

test("fix details and mark closed edit the place", async () => {
  const { sqlite, db, place } = await verified();
  const fix = report(sqlite, "place", place, "wrong-details");
  assert.deepEqual(await actOnReport(fix, "mod", { action: "fix-details", details: { name: "Noor Grill & Café", website: "ftp://x" } }, db), {
    ok: false,
    status: 400,
    error: "Websites start with http:// or https://.",
  });
  assert.deepEqual(await actOnReport(fix, "mod", { action: "fix-details", details: { name: "Noor Grill & Café" } }, db), { ok: true });
  assert.equal((await getPlaceById(place, db))?.name, "Noor Grill & Café");
  const closed = report(sqlite, "place", place, "closed");
  await actOnReport(closed, "mod", { action: "mark-closed" }, db);
  const row = sqlite.prepare(`SELECT listing_status FROM places WHERE id = ?`).get(place) as { listing_status: string };
  assert.equal(row.listing_status, "closed");
});
