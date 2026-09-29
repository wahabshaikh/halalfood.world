import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { EMPTY_FILTERS, type WhosePlaces } from "@halalfood/core/discovery-filters";
import { discoverPlaces } from "../src/lib/discovery";
import { mapSocialFor } from "../src/lib/map-social-repository";
import { blockUser, followUser } from "../src/lib/social-repository";
import { updateProfile } from "../src/lib/preferences-repository";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const P1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const P2 = "9c858901-8a57-4791-81fe-4c455b099bc9";
const P3 = "0b6e3c5a-6f4d-4f0e-a1c2-3d4e5f607182";

/** ayesha follows zaid; zaid shared a visit to P1. ayesha visited P2 and saved P3. */
async function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["ayesha", "zaid", "mariam"]) addUser(sqlite, id);
  await updateProfile("ayesha", { handle: "ayesha_eats", displayName: "Ayesha" }, db);
  await updateProfile("zaid", { handle: "zaid_bites", displayName: "Zaid Khan" }, db);
  await updateProfile("mariam", { handle: "mariam_m", displayName: "Mariam" }, db);
  sqlite.exec(`UPDATE user_profiles SET onboarded_at = 1`);
  for (const [id, name] of [
    [P1, "Zaffran Grill"],
    [P2, "Nalli Nihari House"],
    [P3, "Malpua Lane"],
  ])
    sqlite
      .prepare(
        `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed, lat, lng)
         VALUES (?, ?, 'mumbai', 'u', 'a', '[]', 's', 'u', 1, 1, 1, 19.07, 72.87)`,
      )
      .run(id, name);
  await followUser("ayesha", "zaid_bites", db);
  visit(sqlite, "v1", "zaid", P1, { verdict: "favourite", shared: true });
  visit(sqlite, "v2", "ayesha", P2, { verdict: "liked", shared: true });
  sqlite.prepare(`INSERT INTO saved_places (user_id, place_id, created_at) VALUES ('ayesha', ?, 1)`).run(P3);
  return { sqlite, db };
}

function visit(
  sqlite: DatabaseSync,
  id: string,
  userId: string,
  placeId: string,
  options: { verdict?: string; shared?: boolean; visibility?: "public" | "private"; at?: number } = {},
) {
  const at = options.at ?? Date.now();
  sqlite
    .prepare(
      `INSERT INTO place_visits (id, user_id, place_id, visited_at, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, placeId, at, options.visibility ?? "public", at, at);
  sqlite
    .prepare(
      `INSERT INTO place_check_ins (visit_id, place_id, user_id, would_return, value_verdict, verdict, created_at, updated_at) VALUES (?, ?, ?, 'definitely', 'fair', ?, ?, ?)`,
    )
    .run(id, placeId, userId, options.verdict ?? null, at, at);
  if (options.shared)
    sqlite
      .prepare(`INSERT INTO feed_events (id, actor_id, kind, visit_id, place_id, created_at) VALUES (?, ?, 'visit', ?, ?, ?)`)
      .run(`e-${id}`, userId, id, placeId, at);
}

async function ids(db: Awaited<ReturnType<typeof world>>["db"], whose: WhosePlaces, viewerId: string | null) {
  const result = await discoverPlaces(
    { filters: { ...EMPTY_FILTERS, whose }, limit: 50, viewerId },
    db,
  );
  return result.places.map((place) => place.id).sort();
}

test("everyone shows every place, whoever is asking", async () => {
  const { db } = await world();
  assert.deepEqual(await ids(db, "everyone", null), [P1, P2, P3].sort());
});

test("your places are the ones you visited or saved", async () => {
  const { db } = await world();
  assert.deepEqual(await ids(db, "mine", "ayesha"), [P2, P3].sort());
  assert.deepEqual(await ids(db, "mine", "mariam"), []);
});

test("friends only shows shared visits from people you follow", async () => {
  const { sqlite, db } = await world();
  assert.deepEqual(await ids(db, "friends", "ayesha"), [P1]);
  // Someone who follows nobody sees nothing, and a signed-out request matches nothing.
  assert.deepEqual(await ids(db, "friends", "mariam"), []);
  assert.deepEqual(await ids(db, "friends", null), []);
  assert.deepEqual(await ids(db, "mine", null), []);

  // An unshared visit, a private visit and a pending request all stay off the map.
  visit(sqlite, "v3", "zaid", P2, { verdict: "liked", shared: false });
  visit(sqlite, "v4", "zaid", P3, { verdict: "liked", shared: true, visibility: "private" });
  assert.deepEqual(await ids(db, "friends", "ayesha"), [P1]);
  sqlite.exec(`UPDATE follows SET status = 'pending'`);
  assert.deepEqual(await ids(db, "friends", "ayesha"), []);
});

test("a friend who keeps visits private, or blocks you, disappears from the map", async () => {
  const { sqlite, db } = await world();
  sqlite.exec(`INSERT INTO user_preferences (user_id, visibility_visits, created_at, updated_at) VALUES ('zaid', 'private', 1, 1)`);
  assert.deepEqual(await ids(db, "friends", "ayesha"), []);
  assert.deepEqual(await mapSocialFor("ayesha", [P1], db), {});
  sqlite.exec(`DELETE FROM user_preferences`);
  assert.deepEqual(await ids(db, "friends", "ayesha"), [P1]);
  await blockUser("zaid", "ayesha", db);
  assert.deepEqual(await ids(db, "friends", "ayesha"), []);
});

test("pins carry friend faces, a label, and your own history", async () => {
  const { sqlite, db } = await world();
  const social = await mapSocialFor("ayesha", [P1, P2, P3], db);
  assert.deepEqual(Object.keys(social).sort(), [P1, P2, P3].sort());
  assert.equal(social[P1].label, "Zaid's favourite");
  assert.equal(social[P1].friends[0].handle, "zaid_bites");
  assert.equal(social[P1].friendCount, 1);
  assert.equal(social[P1].you, null);
  assert.equal(social[P2].label, "You have been");
  assert.equal(social[P2].you, "been");
  assert.equal(social[P3].label, "On your want-to-try");
  assert.equal(social[P3].you, "want");

  // Only the newest visit per friend counts, and places not on screen are skipped.
  visit(sqlite, "v5", "zaid", P1, { verdict: "disliked", shared: true, at: Date.now() + 10 });
  const again = await mapSocialFor("ayesha", [P1], db);
  assert.deepEqual(Object.keys(again), [P1]);
  assert.equal(again[P1].friendCount, 1);
  assert.equal(again[P1].friends[0].verdict, "disliked");
  assert.deepEqual(await mapSocialFor("ayesha", [], db), {});
});

test("a stranger's pins show nothing", async () => {
  const { db } = await world();
  assert.deepEqual(await mapSocialFor("mariam", [P1, P2, P3], db), {});
});
