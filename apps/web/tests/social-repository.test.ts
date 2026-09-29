import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOnboarding } from "@halalfood/core/social";
import {
  acceptAllPendingRequests,
  blockUser,
  completeOnboarding,
  followCounts,
  followUser,
  getFollowStatus,
  isHandleAvailable,
  listBlocked,
  listConnections,
  relationTo,
  respondToFollowRequest,
  searchPeople,
  setAvatarKey,
  unblockUser,
  unfollowUser,
} from "../src/lib/social-repository";
import {
  getOrCreateProfile,
  getPreferences,
  updateProfile,
} from "../src/lib/preferences-repository";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const LISTED = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const UNLISTED = "9c858901-8a57-4791-81fe-4c455b099bc9";

/** Three onboarded diners: ayesha (public), zaid (public) and hafsa (private). */
async function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["ayesha", "zaid", "hafsa"]) addUser(sqlite, id);
  await updateProfile("ayesha", { handle: "ayesha_eats", displayName: "Ayesha Khan" }, db);
  await updateProfile("zaid", { handle: "zaid_bites", displayName: "Zaid" }, db);
  await updateProfile("hafsa", { handle: "hafsa_k", displayName: "Hafsa K", isPrivate: true }, db);
  sqlite.exec(`UPDATE user_profiles SET onboarded_at = 1`);
  for (const [id, listed] of [
    [LISTED, 1],
    [UNLISTED, 0],
  ] as const)
    sqlite
      .prepare(
        `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed)
         VALUES (?, ?, 'mumbai', 'u', 'a', '[]', 's', 'u', 1, 1, ?)`,
      )
      .run(id, `Place ${id.slice(0, 4)}`, listed);
  return { sqlite, db };
}

test("following a public account is accepted and counted", async () => {
  const { db } = await world();
  assert.deepEqual(await followUser("ayesha", "zaid_bites", db), { ok: true, status: "accepted" });
  assert.equal(await getFollowStatus("ayesha", "zaid", db), "accepted");
  assert.deepEqual(await followCounts("zaid", db), { followers: 1, following: 0 });
  assert.deepEqual(await followCounts("ayesha", db), { followers: 0, following: 1 });
  // Idempotent.
  assert.deepEqual(await followUser("ayesha", "zaid_bites", db), { ok: true, status: "accepted" });
  assert.deepEqual(await followCounts("zaid", db), { followers: 1, following: 0 });
});

test("following a private account is a request that only counts once accepted", async () => {
  const { db } = await world();
  assert.deepEqual(await followUser("ayesha", "hafsa_k", db), { ok: true, status: "pending" });
  assert.deepEqual(await followCounts("hafsa", db), { followers: 0, following: 0 });
  assert.equal(await relationTo("ayesha", "hafsa", db), "requested");
  assert.deepEqual(
    (await listConnections("hafsa", "requests", "hafsa", db)).map((p) => p.handle),
    ["ayesha_eats"],
  );

  assert.equal(await respondToFollowRequest("hafsa", "ayesha_eats", true, db), true);
  assert.equal(await relationTo("ayesha", "hafsa", db), "following");
  assert.deepEqual(await followCounts("hafsa", db), { followers: 1, following: 0 });
  // Nothing pending is left to respond to.
  assert.equal(await respondToFollowRequest("hafsa", "ayesha_eats", true, db), false);
});

test("declining a request removes it, and withdrawing works the same way", async () => {
  const { db } = await world();
  await followUser("ayesha", "hafsa_k", db);
  assert.equal(await respondToFollowRequest("hafsa", "ayesha_eats", false, db), true);
  assert.equal(await getFollowStatus("ayesha", "hafsa", db), null);

  await followUser("zaid", "hafsa_k", db);
  await unfollowUser("zaid", "hafsa_k", db);
  assert.equal(await getFollowStatus("zaid", "hafsa", db), null);
  // Unfollowing someone you do not follow is harmless.
  await unfollowUser("zaid", "hafsa_k", db);
});

test("you cannot follow yourself or an account that does not exist", async () => {
  const { db } = await world();
  assert.deepEqual(await followUser("ayesha", "ayesha_eats", db), { ok: false, reason: "self" });
  assert.deepEqual(await followUser("ayesha", "nobody", db), { ok: false, reason: "not-found" });
});

test("a private account that goes public accepts everyone waiting", async () => {
  const { db } = await world();
  await followUser("ayesha", "hafsa_k", db);
  await followUser("zaid", "hafsa_k", db);
  await updateProfile("hafsa", { isPrivate: false }, db);
  await acceptAllPendingRequests("hafsa", db);
  assert.deepEqual(await followCounts("hafsa", db), { followers: 2, following: 0 });
});

test("blocking removes follows in both directions and stops new ones", async () => {
  const { db } = await world();
  await followUser("ayesha", "zaid_bites", db);
  await followUser("zaid", "ayesha_eats", db);

  await blockUser("ayesha", "zaid", db);
  assert.equal(await getFollowStatus("ayesha", "zaid", db), null);
  assert.equal(await getFollowStatus("zaid", "ayesha", db), null);
  assert.equal(await relationTo("zaid", "ayesha", db), "blocked");
  assert.equal(await relationTo("ayesha", "zaid", db), "blocked");

  // Neither side can follow, and the refusal looks like a missing account.
  assert.deepEqual(await followUser("zaid", "ayesha_eats", db), { ok: false, reason: "not-found" });
  assert.deepEqual(await followUser("ayesha", "zaid_bites", db), { ok: false, reason: "not-found" });

  assert.deepEqual((await listBlocked("ayesha", db)).map((p) => p.handle), ["zaid_bites"]);
  assert.deepEqual(await listBlocked("zaid", db), []);
});

test("blocking twice is harmless and unblocking restores the ability to follow", async () => {
  const { db } = await world();
  await blockUser("ayesha", "zaid", db);
  await blockUser("ayesha", "zaid", db);
  await unblockUser("ayesha", "zaid", db);
  assert.equal(await relationTo("zaid", "ayesha", db), "none");
  assert.deepEqual(await followUser("zaid", "ayesha_eats", db), { ok: true, status: "accepted" });
});

test("blocked people disappear from search and connection lists", async () => {
  const { db } = await world();
  await followUser("zaid", "ayesha_eats", db);
  assert.deepEqual((await listConnections("ayesha", "followers", "hafsa", db)).map((p) => p.handle), ["zaid_bites"]);
  await blockUser("hafsa", "zaid", db);
  assert.deepEqual(await listConnections("ayesha", "followers", "hafsa", db), []);
  assert.deepEqual((await searchPeople("zaid", "hafsa", 20, db)).map((p) => p.handle), []);
  assert.deepEqual((await searchPeople("zaid", "ayesha", 20, db)).map((p) => p.handle), ["zaid_bites"]);
});

test("search matches handle prefixes and names, skips you and the unfinished", async () => {
  const { sqlite, db } = await world();
  assert.deepEqual((await searchPeople("@zai", "ayesha", 20, db)).map((p) => p.handle), ["zaid_bites"]);
  assert.deepEqual((await searchPeople("khan", "zaid", 20, db)).map((p) => p.handle), ["ayesha_eats"]);
  // Never lists the searcher.
  assert.deepEqual(await searchPeople("ayesha", "ayesha", 20, db), []);
  // Too short to search.
  assert.deepEqual(await searchPeople("z", "ayesha", 20, db), []);
  // Wildcards are literal.
  assert.deepEqual(await searchPeople("%%", "ayesha", 20, db), []);
  assert.deepEqual(await searchPeople("a_", "zaid", 20, db), []);
  // Someone who has not finished onboarding is not listed.
  sqlite.exec(`UPDATE user_profiles SET onboarded_at = NULL WHERE user_id = 'zaid'`);
  assert.deepEqual(await searchPeople("zaid", "ayesha", 20, db), []);
});

test("handles are unique, but you keep your own", async () => {
  const { db } = await world();
  assert.equal(await isHandleAvailable("zaid_bites", null, db), false);
  assert.equal(await isHandleAvailable("zaid_bites", "zaid", db), true);
  assert.equal(await isHandleAvailable("brand_new", "zaid", db), true);
});

test("onboarding claims the handle, writes the standard and saves only listed places", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "newbie");
  addUser(sqlite, "zaid");
  await updateProfile("zaid", { handle: "zaid_bites", displayName: "Zaid" }, db);
  sqlite.prepare(
    `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed)
     VALUES (?, 'A', 'mumbai', 'u', 'a', '[]', 's', 'u', 1, 1, 1), (?, 'B', 'mumbai', 'u', 'a', '[]', 's', 'u', 1, 1, 0)`,
  ).run(LISTED, UNLISTED);

  const validated = validateOnboarding({
    displayName: "Ayesha Khan",
    handle: "ayesha_eats",
    standard: { preset: "certified", avoidAlcohol: true, preferHandSlaughter: true },
    homeCitySlug: "mumbai",
    wantToTry: [LISTED, UNLISTED],
    invitedByHandle: "zaid_bites",
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const result = await completeOnboarding("newbie", validated.data, db);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.profile.handle, "ayesha_eats");
  assert.equal(result.profile.displayName, "Ayesha Khan");
  assert.equal(result.profile.homeCitySlug, "mumbai");
  assert.notEqual(result.profile.onboardedAt, null);
  assert.equal(result.followed, "accepted");

  const preferences = await getPreferences("newbie", db);
  assert.equal(preferences.minimumStatus, "verified");
  assert.equal(preferences.requireCertification, true);
  assert.equal(preferences.avoidAlcohol, true);
  assert.equal(preferences.preferHandSlaughter, true);
  assert.equal(preferences.homeCitySlug, "mumbai");

  const saved = sqlite.prepare(`SELECT place_id FROM saved_places WHERE user_id = 'newbie'`).all();
  assert.deepEqual(saved.map((row) => row.place_id), [LISTED]);

  assert.equal(await getFollowStatus("newbie", "zaid", db), "accepted");
  const inviter = sqlite.prepare(`SELECT invited_by_user_id FROM user_profiles WHERE user_id = 'newbie'`).get();
  assert.equal(inviter?.invited_by_user_id, "zaid");
});

test("onboarding without a standard leaves existing preferences alone", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "newbie");
  const validated = validateOnboarding({ displayName: "Ayesha", handle: "ayesha_eats" });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const result = await completeOnboarding("newbie", validated.data, db);
  assert.equal(result.ok, true);
  const rows = sqlite.prepare(`SELECT COUNT(*) AS n FROM user_preferences`).get();
  assert.equal(rows?.n, 0);
});

test("onboarding refuses a handle someone else holds, and following a private inviter is a request", async () => {
  const { sqlite, db } = await world();
  addUser(sqlite, "newbie");
  const taken = validateOnboarding({ displayName: "Zed", handle: "zaid_bites" });
  assert.equal(taken.ok, true);
  if (!taken.ok) return;
  assert.deepEqual(await completeOnboarding("newbie", taken.data, db), {
    ok: false,
    reason: "handle-taken",
  });

  const invited = validateOnboarding({ displayName: "Zed", handle: "zed_eats", invitedByHandle: "hafsa_k" });
  assert.equal(invited.ok, true);
  if (!invited.ok) return;
  const result = await completeOnboarding("newbie", invited.data, db);
  assert.equal(result.ok && result.followed, "pending");
});

test("finishing onboarding twice keeps the first completion time", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "newbie");
  const validated = validateOnboarding({ displayName: "Ayesha", handle: "ayesha_eats" });
  if (!validated.ok) throw new Error("invalid");
  const first = await completeOnboarding("newbie", validated.data, db);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await completeOnboarding("newbie", validated.data, db);
  assert.ok(first.ok && second.ok);
  if (first.ok && second.ok)
    assert.equal(second.profile.onboardedAt, first.profile.onboardedAt);
});

test("a profile photo key is stored and cleared", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "newbie");
  await setAvatarKey("newbie", "avatars/x/y.jpg", db);
  assert.equal((await getOrCreateProfile("newbie", db)).avatarKey, "avatars/x/y.jpg");
  await setAvatarKey("newbie", null, db);
  assert.equal((await getOrCreateProfile("newbie", db)).avatarKey, null);
});

test("deleting a user removes their follows and blocks", async () => {
  const { sqlite, db } = await world();
  await followUser("ayesha", "zaid_bites", db);
  await blockUser("zaid", "hafsa", db);
  sqlite.exec(`DELETE FROM "user" WHERE id = 'zaid'`);
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM follows`).get() as { n: number }).n, 0);
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM user_blocks`).get() as { n: number }).n, 0);
});
