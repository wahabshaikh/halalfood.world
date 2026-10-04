import assert from "node:assert/strict";
import test from "node:test";
import { getVisitCard } from "../src/lib/feed-repository";
import { restoredShareToFeed } from "../src/lib/form-draft";
import { listPassportVisits, listPublicCheckIns, listVisitedPlaces } from "../src/lib/visits";
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

test("sharing to feeds is off unless the diner ticked it", () => {
  assert.equal(restoredShareToFeed(null), false);
  // Older drafts recorded the box without saying whether it was chosen.
  assert.equal(restoredShareToFeed({ shareToFeed: true, visibility: "public" }), false);
  assert.equal(
    restoredShareToFeed({ shareToFeed: true, shareToFeedChosen: true, visibility: "public" }),
    true,
  );
  assert.equal(
    restoredShareToFeed({ shareToFeed: true, shareToFeedChosen: true, visibility: "private" }),
    false,
  );
});
