import assert from "node:assert/strict";
import test from "node:test";
import { listRankedDiners } from "../src/lib/diner-leaderboard";
import { canViewVisit } from "@halalfood/core/feed";
import { DEFAULT_PREFERENCES } from "@halalfood/core/user-preferences";
import { getVisitAccess, getVisitCard, listFriendsFeed } from "../src/lib/feed-repository";
import { checkInDraft } from "../src/lib/check-in-draft";
import {
  getCheckInSummary,
  listPassportVisits,
  listPublicCheckIns,
  listVisitedPlaces,
} from "../src/lib/visits";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const PLACE_ID = "0b210f3a-8f70-47f7-a7d0-e4a46ff55fe2";
const SHARED = "11111111-1111-4111-8111-111111111111";
const UNSHARED = "22222222-2222-4222-8222-222222222222";

function setup() {
  const fixture = createTestDatabase();
  const { sqlite } = fixture;
  addUser(sqlite, "author");
  addUser(sqlite, "viewer");
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO user_profiles (user_id, handle, display_name, created_at, updated_at) VALUES ('author', 'author', 'Author', ?, ?)`,
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO places (
        id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
        scraped_at, created_at, halal_confirmed, listing_status
      ) VALUES (?, 'QA TEST Cafe', 'london', '/city/london', '1 High Street', '[]', 'user-submitted',
        'https://example.com/qa', 1, 1, 1, 'listed')`,
    )
    .run(PLACE_ID);
  for (const [id, at] of [
    [SHARED, now - 1000],
    [UNSHARED, now],
  ] as const) {
    sqlite
      .prepare(
        `INSERT INTO place_visits (id, user_id, place_id, visited_at, visibility, created_at, updated_at)
         VALUES (?, 'author', ?, ?, 'public', ?, ?)`,
      )
      .run(id, PLACE_ID, at, at, at);
    sqlite
      .prepare(
        `INSERT INTO place_check_ins (visit_id, place_id, user_id, would_return, value_verdict, note, created_at, updated_at)
         VALUES (?, ?, 'author', 'definitely', 'fair', 'Good', ?, ?)`,
      )
      .run(id, PLACE_ID, at, at);
  }
  // Only the first visit was shared to followers' feeds.
  sqlite
    .prepare(
      `INSERT INTO feed_events (id, actor_id, kind, visit_id, place_id, created_at) VALUES ('fe-shared', 'author', 'visit', ?, ?, ?)`,
    )
    .run(SHARED, PLACE_ID, now);
  return fixture;
}

test("guests and other diners only see visits the owner shared", async () => {
  const { db } = setup();
  const checkIns = await listPublicCheckIns(PLACE_ID, 20, db);
  assert.deepEqual(
    checkIns.map((row) => row.visitId),
    [SHARED],
  );

  assert.ok(await getVisitCard(SHARED, null, db), "a guest opens a shared visit");
  assert.equal(await getVisitCard(UNSHARED, null, db), null, "a guest cannot open an unshared one");
  assert.equal(await getVisitCard(UNSHARED, "viewer", db), null);
  assert.ok(await getVisitCard(UNSHARED, "author", db), "the owner always sees their own");

  const visitedByOthers = await listVisitedPlaces("author", db, { sharedOnly: true });
  assert.equal(visitedByOthers.length, 1);
  const passportForOthers = await listPassportVisits("author", db, { sharedOnly: true });
  assert.equal(passportForOthers.length, 1);
  const ownPassport = await listPassportVisits("author", db);
  assert.equal(ownPassport.length, 2);
});

test("a check-in draft never keeps the share tick", () => {
  const draft = checkInDraft({
    note: "Good",
    visibility: "public",
    shareToFeed: true,
    shareToFeedChosen: true,
  });
  assert.deepEqual(draft, { note: "Good", visibility: "public" });
});

test("visited places, their verdict and the passport use only shared visits to listed places", async () => {
  const { sqlite, db } = setup();
  // The newest visit is unshared and says "no"; nobody else may see that verdict.
  sqlite.prepare(`UPDATE place_check_ins SET would_return = 'no' WHERE visit_id = ?`).run(UNSHARED);
  const forOthers = await listVisitedPlaces("author", db, { sharedOnly: true });
  assert.equal(forOthers.length, 1);
  assert.equal(forOthers[0]!.visits, 1);
  assert.equal(forOthers[0]!.wouldReturn, "definitely");

  // An unpublished place drops out of everyone else's view of the diner.
  sqlite.prepare(`UPDATE places SET listing_status = 'hidden' WHERE id = ?`).run(PLACE_ID);
  assert.equal((await listVisitedPlaces("author", db, { sharedOnly: true })).length, 0);
  assert.equal((await listPassportVisits("author", db, { sharedOnly: true })).length, 0);
  // The owner's own counts leave it out too (QA on 78c86c6: the passport still
  // counted the unpublished QA cafe). Their /visit pages still open for them.
  assert.equal((await listPassportVisits("author", db)).length, 0);
  sqlite.prepare(`UPDATE places SET listing_status = 'listed' WHERE id = ?`).run(PLACE_ID);
  assert.equal((await listPassportVisits("author", db)).length, 2);
});

test("the public leaderboard counts only shared public visits", async () => {
  const { sqlite, db } = setup();
  sqlite
    .prepare(
      `UPDATE user_profiles SET onboarded_at = 1, is_private = 0, show_on_leaderboards = 1 WHERE user_id = 'author'`,
    )
    .run();
  sqlite
    .prepare(`UPDATE place_visits SET verification_method = 'location', verification_confidence = 'high'`)
    .run();
  const now = Date.now() + 10_000;
  const shared = await listRankedDiners("all", null, now, db);
  assert.equal(shared[0]?.verified, 1, "only the shared visit counts");
  sqlite.prepare(`DELETE FROM feed_events`).run();
  assert.equal((await listRankedDiners("all", null, now, db)).length, 0);
});

test("an unshared check-in moves no count a guest can see (AC-08b)", async () => {
  const { sqlite, db } = setup();
  const before = {
    summary: await getCheckInSummary(PLACE_ID, db),
    passport: (await listPassportVisits("author", db, { sharedOnly: true })).length,
    visited: (await listVisitedPlaces("author", db, { sharedOnly: true }))[0]?.visits,
    checkIns: (await listPublicCheckIns(PLACE_ID, 20, db)).length,
  };
  const at = Date.now() + 5;
  const third = "33333333-3333-4333-8333-333333333333";
  sqlite
    .prepare(
      `INSERT INTO place_visits (id, user_id, place_id, visited_at, visibility, created_at, updated_at)
       VALUES (?, 'author', ?, ?, 'public', ?, ?)`,
    )
    .run(third, PLACE_ID, at, at, at);
  sqlite
    .prepare(
      `INSERT INTO place_check_ins (visit_id, place_id, user_id, would_return, value_verdict, note, created_at, updated_at)
       VALUES (?, ?, 'author', 'no', 'overpriced', 'Unshared', ?, ?)`,
    )
    .run(third, PLACE_ID, at, at);
  assert.deepEqual(
    {
      summary: await getCheckInSummary(PLACE_ID, db),
      passport: (await listPassportVisits("author", db, { sharedOnly: true })).length,
      visited: (await listVisitedPlaces("author", db, { sharedOnly: true }))[0]?.visits,
      checkIns: (await listPublicCheckIns(PLACE_ID, 20, db)).length,
    },
    before,
  );
  assert.equal(before.passport, 1);
});

test("a visit to an unlisted place is gone for guests and other diners, not the owner or moderators", async () => {
  const { sqlite, db } = setup();
  sqlite.prepare(`UPDATE places SET listing_status = 'hidden' WHERE id = ?`).run(PLACE_ID);
  addUser(sqlite, "mod");
  sqlite.prepare(`INSERT INTO moderators (user_id, role, created_at) VALUES ('mod', 'moderator', 1)`).run();

  assert.equal(await getVisitCard(SHARED, null, db), null, "a guest gets nothing");
  assert.equal(await getVisitCard(SHARED, "viewer", db), null, "another diner gets nothing");
  const access = await getVisitAccess(SHARED, null, db);
  assert.equal(access?.audience.placeListed, false);
  assert.equal(canViewVisit(access!.audience), false);
  assert.ok(await getVisitCard(SHARED, "author", db), "the owner keeps their own visit page");
  assert.ok(await getVisitCard(SHARED, "mod", db), "moderators can still open it");
  assert.equal((await listPublicCheckIns(PLACE_ID, 20, db)).length, 0);
  assert.deepEqual(
    await getCheckInSummary(PLACE_ID, db),
    await getCheckInSummary("00000000-0000-4000-8000-000000000000", db),
    "the place's check-in counts are empty",
  );

  // Feeds drop it for everyone, the owner included.
  const own = await listFriendsFeed({ viewerId: "author", preferences: DEFAULT_PREFERENCES, limit: 20 }, db);
  assert.equal(own.cards.length, 0);
  sqlite.prepare(`UPDATE places SET listing_status = 'listed' WHERE id = ?`).run(PLACE_ID);
  const listed = await listFriendsFeed({ viewerId: "author", preferences: DEFAULT_PREFERENCES, limit: 20 }, db);
  assert.equal(listed.cards.length, 1, "the same feed shows it once the place is listed");
});
