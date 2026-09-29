import { test } from "node:test";
import assert from "node:assert/strict";
import { validateList } from "@halalfood/core/place-lists";
import {
  addListItem,
  changeListItem,
  createList,
  getListForViewer,
  getEditToken,
  hasCollaborators,
  inviteCollaborator,
  joinListWithToken,
  listCollaboratorsOf,
  listHub,
  listHasPlace,
  listItems,
  removeCollaborator,
  replaceListItems,
  respondToListInvite,
  saveList,
  searchLists,
  setEditLink,
  unsaveList,
  updateList,
} from "../src/lib/lists-repository";
import { blockUser, followUser } from "../src/lib/social-repository";
import { updateProfile } from "../src/lib/preferences-repository";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const P1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const P2 = "9c858901-8a57-4791-81fe-4c455b099bc9";
const P3 = "0b6e3c5a-6f4d-4f0e-a1c2-3d4e5f607182";

/** ayesha owns lists; zaid and mariam are public diners; hafsa is private. */
async function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["ayesha", "zaid", "mariam", "hafsa"]) addUser(sqlite, id);
  await updateProfile("ayesha", { handle: "ayesha_eats", displayName: "Ayesha Khan" }, db);
  await updateProfile("zaid", { handle: "zaid_bites", displayName: "Zaid" }, db);
  await updateProfile("mariam", { handle: "mariam_m", displayName: "Mariam" }, db);
  await updateProfile("hafsa", { handle: "hafsa_k", displayName: "Hafsa K", isPrivate: true }, db);
  sqlite.exec(`UPDATE user_profiles SET onboarded_at = 1`);
  for (const [id, name] of [
    [P1, "Zaffran Grill"],
    [P2, "Nalli Nihari House"],
    [P3, "Malpua Lane"],
  ])
    sqlite
      .prepare(
        `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed)
         VALUES (?, ?, 'mumbai', 'u', 'a', '[]', 's', 'u', 1, 1, 1)`,
      )
      .run(id, name);
  return { sqlite, db };
}

function input(overrides: Record<string, unknown> = {}) {
  const result = validateList({ title: "Eid dinner shortlist", ranked: false, ...overrides });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

test("a list keeps its caption and cover, and shows the first place when no cover is chosen", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input({ caption: "Book early" }), db);
  assert.equal(list.caption, "Book early");
  assert.equal(list.displayCoverPlaceId, null);

  assert.equal(await addListItem(list.id, P1, null, "ayesha", db), "added");
  assert.equal(await addListItem(list.id, P2, "Upstairs room", "ayesha", db), "added");
  assert.equal((await getListForViewer(list.id, "ayesha", db))?.list.displayCoverPlaceId, P1);

  assert.equal(await listHasPlace(list.id, P2, db), true);
  await updateList(list.id, "ayesha", input({ caption: null, coverPlaceId: P2 }), db);
  const after = (await getListForViewer(list.id, "ayesha", db))!.list;
  assert.equal(after.caption, null);
  assert.equal(after.displayCoverPlaceId, P2);

  // Taking the cover place off the list drops the explicit cover.
  assert.equal(await changeListItem(list.id, P2, { userId: "ayesha", role: "owner" }, { remove: true }, db), true);
  assert.equal((await getListForViewer(list.id, "ayesha", db))!.list.coverPlaceId, null);
});

test("adding a place twice, or one that is not listed, is refused", async () => {
  const { sqlite, db } = await world();
  const list = await createList("ayesha", input(), db);
  assert.equal(await addListItem(list.id, P1, null, "ayesha", db), "added");
  assert.equal(await addListItem(list.id, P1, null, "ayesha", db), "exists");
  assert.equal(await addListItem(list.id, "11111111-1111-4111-8111-111111111111", null, "ayesha", db), "not-found");
  sqlite.prepare(`UPDATE places SET halal_confirmed = 0 WHERE id = ?`).run(P3);
  assert.equal(await addListItem(list.id, P3, null, "ayesha", db), "not-found");
});

test("an invited diner sees the list, and only editing follows acceptance", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input({ visibility: "private" }), db);
  assert.equal(await getListForViewer(list.id, "zaid", db), null);

  const invite = await inviteCollaborator(list.id, "ayesha", "zaid_bites", db);
  assert.ok(invite.ok);
  assert.deepEqual(await inviteCollaborator(list.id, "ayesha", "zaid_bites", db), { ok: false, reason: "exists" });
  assert.deepEqual(await inviteCollaborator(list.id, "ayesha", "ayesha_eats", db), { ok: false, reason: "self" });
  assert.deepEqual(await inviteCollaborator(list.id, "ayesha", "nobody_here", db), { ok: false, reason: "not-found" });

  assert.equal((await getListForViewer(list.id, "zaid", db))?.role, "invited");
  assert.equal(await respondToListInvite(list.id, "zaid", true, db), true);
  assert.equal((await getListForViewer(list.id, "zaid", db))?.role, "editor");
  // Nothing left to answer.
  assert.equal(await respondToListInvite(list.id, "zaid", true, db), false);
  assert.deepEqual((await listCollaboratorsOf(list.id, db)).map((c) => [c.handle, c.status]), [["zaid_bites", "accepted"]]);
});

test("declining an invite removes it so the owner can ask again", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input(), db);
  await inviteCollaborator(list.id, "ayesha", "zaid_bites", db);
  assert.equal(await respondToListInvite(list.id, "zaid", false, db), true);
  assert.equal(await hasCollaborators(list.id, db), false);
  assert.ok((await inviteCollaborator(list.id, "ayesha", "zaid_bites", db)).ok);
});

test("editors can take back only what they added", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input(), db);
  await inviteCollaborator(list.id, "ayesha", "zaid_bites", db);
  await respondToListInvite(list.id, "zaid", true, db);

  await addListItem(list.id, P1, "Owner pick", "ayesha", db);
  await addListItem(list.id, P2, "Zaid pick", "zaid", db);
  const zaid = { userId: "zaid", role: "editor" as const };
  assert.equal(await changeListItem(list.id, P1, zaid, { remove: true }, db), false);
  assert.equal(await changeListItem(list.id, P1, zaid, { note: "hijack" }, db), false);
  assert.equal(await changeListItem(list.id, P2, zaid, { note: "Ask for the bheja fry" }, db), true);
  assert.equal(await changeListItem(list.id, P2, { userId: "mariam", role: "viewer" }, { remove: true }, db), false);

  const items = await listItems(list.id, db);
  assert.deepEqual(items.map((i) => [i.placeId, i.note, i.addedByHandle]), [
    [P1, "Owner pick", "ayesha_eats"],
    [P2, "Ask for the bheja fry", "zaid_bites"],
  ]);
  // The owner can remove anything.
  assert.equal(await changeListItem(list.id, P2, { userId: "ayesha", role: "owner" }, { remove: true }, db), true);
});

test("reordering keeps who added each place", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input(), db);
  await inviteCollaborator(list.id, "ayesha", "zaid_bites", db);
  await respondToListInvite(list.id, "zaid", true, db);
  await addListItem(list.id, P1, null, "ayesha", db);
  await addListItem(list.id, P2, null, "zaid", db);
  await replaceListItems(list.id, [{ placeId: P2, note: null }, { placeId: P1, note: null }], db, "ayesha");
  assert.deepEqual((await listItems(list.id, db)).map((i) => i.addedByHandle), ["zaid_bites", "ayesha_eats"]);
});

test("the edit link lets a signed-in diner join, and turning it off stops that", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input(), db);
  assert.equal((await getListForViewer(list.id, "ayesha", db))?.editLinkOn, false);

  const token = await setEditLink(list.id, "ayesha", true, db);
  assert.ok(token && token.length >= 22);
  assert.equal(await getEditToken(list.id, "ayesha", db), token);
  assert.equal(await setEditLink(list.id, "zaid", true, db), null);
  assert.equal((await getListForViewer(list.id, "ayesha", db))?.editLinkOn, true);

  assert.deepEqual(await joinListWithToken(list.id, "mariam", "wrong-token-wrong-token-1", db), { ok: false, reason: "invalid" });
  assert.deepEqual(await joinListWithToken(list.id, "ayesha", token, db), { ok: false, reason: "owner" });
  assert.deepEqual(await joinListWithToken(list.id, "mariam", token, db), { ok: true });
  assert.equal((await getListForViewer(list.id, "mariam", db))?.role, "editor");

  await setEditLink(list.id, "ayesha", false, db);
  assert.deepEqual(await joinListWithToken(list.id, "zaid", token, db), { ok: false, reason: "invalid" });
  // Someone already in stays in until the owner removes them.
  assert.equal(await removeCollaborator(list.id, "mariam", db), true);
});

test("a ranked list cannot be joined through a link", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input({ ranked: true }), db);
  const token = await setEditLink(list.id, "ayesha", true, db);
  assert.deepEqual(await joinListWithToken(list.id, "zaid", token!, db), { ok: false, reason: "invalid" });
});

test("saving counts once, not for your own list, and not for a list you cannot see", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input(), db);
  await addListItem(list.id, P1, null, "ayesha", db);
  assert.deepEqual(await saveList(list.id, "ayesha", db), { ok: false, reason: "own" });
  assert.deepEqual(await saveList(list.id, "zaid", db), { ok: true });
  assert.deepEqual(await saveList(list.id, "zaid", db), { ok: true });
  assert.deepEqual(await saveList(list.id, "mariam", db), { ok: true });
  assert.equal((await getListForViewer(list.id, "zaid", db))?.list.saveCount, 2);
  assert.equal((await getListForViewer(list.id, "zaid", db))?.saved, true);

  const hub = await listHub("zaid", db);
  assert.deepEqual(hub.saved.map((c) => c.id), [list.id]);
  await unsaveList(list.id, "zaid", db);
  assert.equal((await getListForViewer(list.id, "zaid", db))?.saved, false);

  const hidden = await createList("ayesha", input({ title: "Secret", visibility: "private" }), db);
  assert.deepEqual(await saveList(hidden.id, "zaid", db), { ok: false, reason: "not-found" });
});

test("a private account's lists open only for accepted followers", async () => {
  const { sqlite, db } = await world();
  const list = await createList("hafsa", input({ title: "Biryani, ranked", visibility: "public" }), db);
  await addListItem(list.id, P1, null, "hafsa", db);
  assert.equal(await getListForViewer(list.id, "zaid", db), null);
  assert.equal(await getListForViewer(list.id, null, db), null);
  assert.ok(await getListForViewer(list.id, "hafsa", db));

  await followUser("zaid", "hafsa_k", db);
  assert.equal(await getListForViewer(list.id, "zaid", db), null, "a pending request is not a follow");
  sqlite.exec(`UPDATE follows SET status = 'accepted'`);
  assert.ok(await getListForViewer(list.id, "zaid", db));
});

test("blocking removes seats and saves both ways and hides the list", async () => {
  const { db } = await world();
  const list = await createList("ayesha", input(), db);
  await addListItem(list.id, P1, null, "ayesha", db);
  await inviteCollaborator(list.id, "ayesha", "zaid_bites", db);
  await respondToListInvite(list.id, "zaid", true, db);
  await saveList(list.id, "mariam", db);
  const own = await createList("zaid", input({ title: "Zaid list" }), db);
  await saveList(own.id, "ayesha", db);

  await blockUser("ayesha", "zaid", db);
  assert.equal(await getListForViewer(list.id, "zaid", db), null);
  assert.equal(await hasCollaborators(list.id, db), false);
  assert.equal(await getListForViewer(own.id, "ayesha", db), null);
  assert.equal((await listHub("ayesha", db)).saved.length, 0);

  await blockUser("mariam", "ayesha", db);
  assert.equal((await getListForViewer(list.id, "mariam", db)), null);
  assert.deepEqual(await inviteCollaborator(list.id, "ayesha", "mariam_m", db), { ok: false, reason: "not-found" });
});

test("list search finds public lists by title, caption or owner and honours privacy", async () => {
  const { sqlite, db } = await world();
  const biryani = await createList("ayesha", input({ title: "Late-night kebabs", caption: "After isha" }), db);
  await addListItem(biryani.id, P1, null, "ayesha", db);
  const empty = await createList("ayesha", input({ title: "Empty kebab list" }), db);
  const secret = await createList("ayesha", input({ title: "Secret kebabs", visibility: "private" }), db);
  await addListItem(secret.id, P1, null, "ayesha", db);
  const unlisted = await createList("ayesha", input({ title: "Unlisted kebabs", visibility: "unlisted" }), db);
  await addListItem(unlisted.id, P1, null, "ayesha", db);
  const privateOwner = await createList("hafsa", input({ title: "Hafsa kebabs" }), db);
  await addListItem(privateOwner.id, P2, null, "hafsa", db);
  void empty;

  const ids = async (q: string, viewer: string | null) => (await searchLists(q, viewer, 20, db)).map((c) => c.id);
  assert.deepEqual(await ids("kebab", "zaid"), [biryani.id]);
  assert.deepEqual(await ids("isha", "zaid"), [biryani.id]);
  assert.deepEqual(await ids("ayesha_eats", null), [biryani.id]);
  assert.deepEqual(await ids("100%", null), []);

  // Hafsa's list shows for herself and for followers once accepted.
  assert.deepEqual(await ids("hafsa", "hafsa"), [privateOwner.id]);
  assert.deepEqual(await ids("hafsa", "zaid"), []);

  // Most saved first.
  const second = await createList("zaid", input({ title: "More kebabs" }), db);
  await addListItem(second.id, P2, null, "zaid", db);
  await saveList(second.id, "mariam", db);
  await saveList(second.id, "ayesha", db);
  assert.deepEqual((await ids("kebabs", "mariam")).slice(0, 2), [second.id, biryani.id]);

  // With owners who keep lists private, the list stays out of search.
  sqlite.exec(
    `INSERT INTO user_preferences (user_id, visibility_lists, created_at, updated_at) VALUES ('zaid', 'private', 1, 1) ON CONFLICT(user_id) DO UPDATE SET visibility_lists = 'private'`,
  );
  assert.ok(!(await ids("kebabs", "mariam")).includes(second.id));
});

test("the lists hub separates yours, shared, invites and saves", async () => {
  const { db } = await world();
  const mine = await createList("zaid", input({ title: "Mine" }), db);
  const shared = await createList("ayesha", input({ title: "Shared" }), db);
  const invited = await createList("mariam", input({ title: "Invited" }), db);
  await inviteCollaborator(shared.id, "ayesha", "zaid_bites", db);
  await respondToListInvite(shared.id, "zaid", true, db);
  await inviteCollaborator(invited.id, "mariam", "zaid_bites", db);
  const hub = await listHub("zaid", db);
  assert.deepEqual(hub.mine.map((c) => c.id), [mine.id]);
  assert.deepEqual(hub.collaborating.map((c) => c.id), [shared.id]);
  assert.deepEqual(hub.invites.map((c) => c.id), [invited.id]);
  assert.equal(hub.collaborating[0].owner.handle, "ayesha_eats");
});
