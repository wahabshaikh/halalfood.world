import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheck } from "@/lib/core/check";
import { validateRec } from "@/lib/core/recs";
import { createCheck } from "./checks-repository";
import { addComment, feedPage, getVisit, listComments, setLike } from "./feed";
import { listActivity, listRecs, markRead, replyRec, sendRecs, unreadCount } from "./inbox";
import { block, follow } from "./people";
import { addPlace, addProfile, addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";

let counter = 0;
function check(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const result = validateCheck({ owned: "yes", pork: "no", verdict: "loved", note: "So good", idempotencyKey: `k-${String(counter).padStart(10, "0")}`, ...overrides });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function world() {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "amal");
  addUser(sqlite, "bilal");
  addUser(sqlite, "carys");
  addProfile(sqlite, "amal", { handle: "amal" });
  addProfile(sqlite, "bilal", { handle: "bilal" });
  addProfile(sqlite, "carys", { handle: "carys", isPrivate: true });
  const place = addPlace(sqlite, { name: "Noor Grill" });
  return { sqlite, db, place };
}

test("the feed shows followees' shared checks, never unshared ones", async () => {
  const { db, place } = world();
  await follow("amal", "bilal", {}, db);
  const shared = await createCheck("bilal", place, check(), db);
  await createCheck("bilal", place, check({ shared: false }), db, Date.now() + 1000);
  const page = await feedPage("amal", null, db);
  assert.deepEqual(page.items.map((item) => item.checkId), [shared.checkId]);
  assert.equal(page.items[0].verdict, "loved");
  assert.equal(page.items[0].author.handle, "bilal");
});

test("a private account's visits show only to accepted followers", async () => {
  const { db, place } = world();
  const visit = await createCheck("carys", place, check(), db);
  assert.equal(await getVisit(visit.checkId, null, db), null);
  assert.equal(await getVisit(visit.checkId, "amal", db), null);
  await follow("amal", "carys", {}, db);
  assert.equal(await getVisit(visit.checkId, "amal", db), null, "a pending request is not enough");
  const { answerRequest } = await import("./people");
  await answerRequest("carys", "amal", true, db);
  assert.ok(await getVisit(visit.checkId, "amal", db));
  assert.ok(await getVisit(visit.checkId, "carys", db), "authors always see their own");
});

test("blocks hide visits and stop likes", async () => {
  const { db, place } = world();
  const visit = await createCheck("bilal", place, check(), db);
  await block("bilal", "amal", db);
  assert.equal(await getVisit(visit.checkId, "amal", db), null);
  assert.equal(await setLike(visit.checkId, "amal", true, db), null);
});

test("likes notify the author once per day; comments notify the author and earlier commenters", async () => {
  const { sqlite, db, place } = world();
  const visit = await createCheck("bilal", place, check(), db);
  assert.deepEqual(await setLike(visit.checkId, "amal", true, db), { liked: true, likes: 1 });
  await setLike(visit.checkId, "amal", false, db);
  await setLike(visit.checkId, "amal", true, db);
  await addComment(visit.checkId, "carys", "Was it busy?", db);
  await addComment(visit.checkId, "amal", "Going Friday", db);
  const rows = sqlite.prepare(`SELECT user_id, kind FROM notifications ORDER BY created_at`).all() as { user_id: string; kind: string }[];
  assert.deepEqual(
    rows.map((row) => `${row.user_id}:${row.kind}`),
    ["bilal:like", "bilal:comment", "bilal:comment", "carys:comment"],
  );
  assert.equal((await listComments(visit.checkId, "amal", db))?.length, 2);
  const activity = await listActivity("bilal", null, db);
  assert.match(activity.items[activity.items.length - 1].text, /^amal liked your visit to Noor Grill$/);
  assert.equal(await unreadCount("bilal", db), 3);
  await markRead("bilal", null, db);
  assert.equal(await unreadCount("bilal", db), 0);
});

test("recs go to people you follow or who follow you; want-to-try saves the place", async () => {
  const { sqlite, db, place } = world();
  await follow("amal", "bilal", {}, db);
  const rec = validateRec({ to: ["bilal", "carys"], placeId: place, note: "Try the grill" });
  assert.ok(rec.ok);
  const result = await sendRecs("amal", rec.rec, db);
  assert.deepEqual(result, { sent: 1, skipped: ["carys"] });
  const inbox = await listRecs("bilal", null, db);
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].note, "Try the grill");
  assert.equal(await replyRec("bilal", inbox.items[0].id, "want-to-try", db), true);
  assert.ok(sqlite.prepare(`SELECT 1 FROM saved_places WHERE user_id = 'bilal' AND place_id = ?`).get(place));
  const activity = await listActivity("amal", null, db);
  assert.equal(activity.items[0].text, "bilal saved Noor Grill");
});
