import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheck } from "@halalfood/core/check";
import { createCheck } from "../src/lib/checks-repository";
import { acceptInvite, addItem, createList, exploreLists, getList, inviteMembers, myLists, removeItem, reorderItems, setListSaved } from "../src/lib/lists";
import { follow } from "../src/lib/people";
import { addPlace, addProfile, addUser, createTestDatabase } from "./support/sqlite-d1";

function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["amal", "bilal", "carys"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id, { handle: id });
  }
  const a = addPlace(sqlite, { name: "Noor Grill" });
  const b = addPlace(sqlite, { name: "Zam Zam" });
  return { sqlite, db, a, b };
}

let n = 0;
async function checkIn(db: ReturnType<typeof world>["db"], userId: string, placeId: string) {
  n += 1;
  const input = validateCheck({ owned: "yes", idempotencyKey: `list-key-${String(n).padStart(6, "0")}` });
  if (!input.ok) throw new Error(input.error);
  await createCheck(userId, placeId, input.value, db);
}

test("only moderators make guides; visibility defaults from the profile", async () => {
  const { sqlite, db } = world();
  assert.deepEqual(await createList("amal", { title: "Best of", kind: "guide" }, { moderator: false }, db), {
    ok: false,
    status: 403,
    error: "Only moderators can make guides.",
  });
  sqlite.prepare(`UPDATE profiles SET lists_private_default = 1 WHERE user_id = 'amal'`).run();
  const made = await createList("amal", { title: "Later", kind: "plan" }, { moderator: false }, db);
  assert.ok(made.ok);
  assert.equal((await getList(made.value, "amal", db))?.visibility, "private");
  assert.equal(await getList(made.value, "bilal", db), null, "a private list is hidden from others");
});

test("ranked lists only take places the owner has checked, and reorder", async () => {
  const { db, a, b } = world();
  const made = await createList("amal", { title: "Top grills", kind: "ranked" }, { moderator: false }, db);
  assert.ok(made.ok);
  assert.equal((await addItem(made.value, "amal", a, null, db)).ok, false);
  await checkIn(db, "amal", a);
  await checkIn(db, "amal", b);
  assert.ok((await addItem(made.value, "amal", a, "The mixed grill", db)).ok);
  assert.ok((await addItem(made.value, "amal", b, null, db)).ok);
  assert.deepEqual((await getList(made.value, "amal", db))?.places.map((item) => item.id), [a, b]);
  assert.ok((await reorderItems(made.value, "amal", [b, a], db)).ok);
  const list = await getList(made.value, "amal", db);
  assert.deepEqual(list?.places.map((item) => item.id), [b, a]);
  assert.equal(list?.been, 2);
  assert.equal(list?.places[1].note, "The mixed grill");
  assert.equal((await reorderItems(made.value, "bilal", [a, b], db)).ok, false);
});

test("plan members add places; only the owner or the adder removes them", async () => {
  const { db, a, b } = world();
  const made = await createList("amal", { title: "Friday", kind: "plan", visibility: "followers" }, { moderator: false }, db);
  assert.ok(made.ok);
  assert.equal((await addItem(made.value, "bilal", a, null, db)).ok, false, "not a member yet");
  assert.deepEqual(await inviteMembers(made.value, "amal", ["bilal"], db), { ok: true, value: 1 });
  assert.equal((await getList(made.value, "bilal", db))?.role, "invited");
  assert.ok((await acceptInvite(made.value, "bilal", db)).ok);
  assert.ok((await addItem(made.value, "bilal", a, null, db)).ok);
  assert.ok((await addItem(made.value, "amal", b, null, db)).ok);
  assert.equal((await removeItem(made.value, "bilal", b, db)).ok, false, "bilal didn't add Zam Zam");
  assert.ok((await removeItem(made.value, "bilal", a, db)).ok);
  const groups = await myLists("bilal", db);
  assert.deepEqual(groups.planning.map((list) => list.title), ["Friday"]);
});

test("followers lists show to accepted followers; others can save public lists", async () => {
  const { db, a } = world();
  const followers = await createList("amal", { title: "Close friends", kind: "plan", visibility: "followers" }, { moderator: false, placeId: a }, db);
  const open = await createList("amal", { title: "Mumbai musts", kind: "plan", visibility: "public" }, { moderator: false, placeId: a }, db);
  assert.ok(followers.ok && open.ok);
  assert.equal(await getList(followers.value, "carys", db), null);
  await follow("carys", "amal", {}, db);
  assert.ok(await getList(followers.value, "carys", db));
  assert.ok((await setListSaved(open.value, "carys", true, db)).ok);
  assert.deepEqual((await myLists("carys", db)).saved.map((list) => list.title), ["Mumbai musts"]);
  assert.deepEqual((await exploreLists("mumbai", db)).map((list) => list.title), ["Mumbai musts"]);
});
