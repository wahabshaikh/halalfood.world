import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheck } from "@halalfood/core/check";
import { createCheck } from "../src/lib/checks-repository";
import { answerRequest, block, follow, listRequests, suggestedPeople } from "../src/lib/people";
import { deleteAccount, ensureProfile, getProfile, parseProfilePatch, updateProfile } from "../src/lib/profiles";
import { addPlace, addProfile, addUser, createTestDatabase } from "./support/sqlite-d1";

function key(n: number) {
  return `key-${String(n).padStart(8, "0")}`;
}

test("a first profile takes its handle from the email, and a taken one gets a suffix", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "sara", "Sara Khan");
  addUser(sqlite, "other");
  addProfile(sqlite, "other", { handle: "sara" });
  const profile = await ensureProfile("sara", db);
  assert.ok(profile);
  assert.match(profile.handle, /^sara\d{4}$/);
  assert.equal(profile.displayName, "Sara Khan");
  assert.equal(profile.onboarded, false);
  assert.equal((await ensureProfile("sara", db))?.handle, profile.handle, "a second call returns the same profile");
});

test("profile edits validate and refuse a taken handle", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "a");
  addUser(sqlite, "b");
  addProfile(sqlite, "a", { handle: "amal" });
  addProfile(sqlite, "b", { handle: "bilal" });
  assert.equal(parseProfilePatch({ handle: "x" }).ok, false);
  assert.equal(parseProfilePatch({ bio: "x".repeat(161) }).ok, false);
  const patch = parseProfilePatch({ handle: "Bilal", displayName: "Amal", defaultFilters: ["owned", "nope"], isPrivate: true });
  assert.ok(patch.ok);
  assert.deepEqual(patch.patch.defaultFilters, ["owned"]);
  const taken = await updateProfile("a", patch.patch, db);
  assert.deepEqual(taken, { ok: false, status: 409, error: "That handle is taken." });
  const ok = await updateProfile("a", { ...patch.patch, handle: "amal.k" }, db);
  assert.ok(ok.ok);
  assert.equal(ok.profile.handle, "amal.k");
  assert.equal(ok.profile.isPrivate, true);
  assert.deepEqual(ok.profile.defaultFilters, ["owned"]);
});

test("following a private account is a request until accepted, with notifications", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "a");
  addUser(sqlite, "b");
  addProfile(sqlite, "a", { handle: "amal" });
  addProfile(sqlite, "b", { handle: "bilal", isPrivate: true });
  assert.deepEqual(await follow("a", "bilal", {}, db), { ok: true, status: "pending" });
  assert.deepEqual((await listRequests("b", db)).map((p) => p.handle), ["amal"]);
  assert.equal(await answerRequest("b", "amal", true, db), true);
  const row = sqlite.prepare(`SELECT status FROM follows WHERE follower_id = 'a' AND followee_id = 'b'`).get() as { status: string };
  assert.equal(row.status, "accepted");
  const kinds = sqlite.prepare(`SELECT user_id, kind FROM notifications ORDER BY created_at`).all() as { user_id: string; kind: string }[];
  assert.deepEqual(kinds.map((n) => `${n.user_id}:${n.kind}`).sort(), ["a:follow-accepted", "b:follow-request"]);
  assert.deepEqual(await follow("a", "amal", {}, db), { ok: false, status: 400, error: "You can’t follow yourself." });
});

test("going public accepts pending requests", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "a");
  addUser(sqlite, "b");
  addProfile(sqlite, "a", { handle: "amal" });
  addProfile(sqlite, "b", { handle: "bilal", isPrivate: true });
  await follow("a", "bilal", {}, db);
  await updateProfile("b", { isPrivate: false }, db);
  const row = sqlite.prepare(`SELECT status FROM follows WHERE follower_id = 'a'`).get() as { status: string };
  assert.equal(row.status, "accepted");
});

test("a block removes follows both ways and refuses new ones", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "a");
  addUser(sqlite, "b");
  addProfile(sqlite, "a", { handle: "amal" });
  addProfile(sqlite, "b", { handle: "bilal" });
  await follow("a", "bilal", {}, db);
  await follow("b", "amal", {}, db);
  assert.equal(await block("a", "bilal", db), true);
  assert.equal((sqlite.prepare(`SELECT count(*) AS n FROM follows`).get() as { n: number }).n, 0);
  assert.deepEqual(await follow("b", "amal", {}, db), { ok: false, status: 404, error: "That person could not be found." });
  assert.equal((await suggestedPeople("b", null, db)).length, 0);
});

test("deleting an account keeps its checks anonymously, so the status holds", async () => {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["a", "b", "c"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id);
  }
  const place = addPlace(sqlite);
  let now = Date.now();
  for (const [index, id] of ["a", "b", "c"].entries()) {
    const check = validateCheck({ owned: "yes", certified: "yes", pork: "no", alcohol: "no", note: "Great", idempotencyKey: key(index) });
    if (!check.ok) throw new Error(check.error);
    await createCheck(id, place, check.value, db, (now += 1000));
  }
  await deleteAccount("a", db, now + 1000);
  assert.equal(await getProfile("a", db), null);
  const checks = sqlite.prepare(`SELECT user_id, note, shared FROM checks ORDER BY created_at`).all() as Record<string, unknown>[];
  assert.equal(checks.length, 3);
  assert.match(String(checks[0].user_id), /^deleted-/);
  assert.equal(checks[0].note, null);
  assert.equal(checks[0].shared, 0);
  const { recomputePlaceStatus } = await import("../src/lib/checks-repository");
  const result = await recomputePlaceStatus(place, db, now + 2000);
  assert.deepEqual(result.after, { kind: "verified" });
});
