import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminPlaceGet, handleAdminPlacePost } from "../app/api/admin/places/[id]/route";
import { handleAdminReview } from "../app/api/admin/review/[kind]/[id]/route";
import {
  listingCachedRead,
  listingVersion,
  placeCacheTags,
  publishListingChange,
  resetListingVersionMemo,
} from "../src/lib/listing-cache";
import { listModeratorHiddenPlaces } from "../src/lib/listing-moderation";
import { getModeratorRole } from "../src/lib/preferences-repository";
import { findPlaces, findPlacesByCity } from "../src/lib/places";
import { clearReadCache } from "../src/lib/read-cache";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const PLACE_ID = "0b210f3a-8f70-47f7-a7d0-e4a46ff55fe2";
const RULE_HIDDEN_ID = "7c1d2e3f-1111-4222-8333-444455556666";
const SUBMISSION_ID = "35637dae-2222-4222-8222-222222222222";

type Db = ReturnType<typeof createTestDatabase>;

function setup(): Db {
  clearReadCache();
  resetListingVersionMemo();
  const fixture = createTestDatabase();
  addUser(fixture.sqlite, "moderator");
  addUser(fixture.sqlite, "diner");
  addUser(fixture.sqlite, "submitter");
  fixture.sqlite
    .prepare(`INSERT INTO moderators (user_id, role, created_at) VALUES ('moderator', 'moderator', 1)`)
    .run();
  return fixture;
}

function insertPlace(
  sqlite: Db["sqlite"],
  id: string,
  options: { name?: string; status?: string; lat?: number | null; lng?: number | null } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO places (
        id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
        scraped_at, created_at, halal_confirmed, listing_status, lat, lng
      ) VALUES (?, ?, 'london', '/city/london', '1 High Street', '[]', 'user-submitted',
        'https://example.com/qa', 1, 1, 1, ?, ?, ?)`,
    )
    .run(
      id,
      options.name ?? "QA TEST Cafe",
      options.status ?? "listed",
      options.lat ?? null,
      options.lng ?? null,
    );
}

function deps(db: Db["db"], userId: string) {
  return {
    getAuth: async () => ({ status: "authenticated" as const, userId }),
    getRole: (candidate: string) => getModeratorRole(candidate, db),
    database: db,
  };
}

function post(db: Db["db"], userId: string, body: unknown, id = PLACE_ID) {
  return handleAdminPlacePost(
    new Request(`https://halalfood.world/api/admin/places/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
    deps(db, userId),
  );
}

test("text search finds a listed place that has no map pin yet", async () => {
  const { sqlite, db } = setup();
  insertPlace(sqlite, PLACE_ID);
  const found = await findPlaces({ q: "QA TEST", limit: 10 }, db);
  assert.deepEqual(
    found.places.map((place) => place.id),
    [PLACE_ID],
  );
  // The map still needs a pin.
  const viewport = await findPlaces(
    { bbox: { west: -1, south: 51, east: 1, north: 52 }, limit: 10 },
    db,
  );
  assert.equal(viewport.places.length, 0);
});

test("a listing change moves every listing read to a new cache key", async () => {
  const { sqlite, db } = setup();
  insertPlace(sqlite, PLACE_ID);
  assert.equal(await listingVersion(db), "0");
  let loads = 0;
  const read = () => listingCachedRead("test:key", 600, async () => ++loads, db);
  assert.equal(await read(), 1);
  assert.equal(await read(), 1, "same version reuses the cached value");

  await publishListingChange(
    { actorUserId: "moderator", change: "test", placeId: PLACE_ID, citySlug: "london" },
    db,
  );
  const version = await listingVersion(db);
  assert.notEqual(version, "0");
  assert.equal(await read(), 2, "a new version reads fresh data");

  // Versions only move forward even when two changes land in one millisecond.
  resetListingVersionMemo();
  await publishListingChange(
    { actorUserId: "moderator", change: "test", placeId: PLACE_ID, citySlug: "london" },
    db,
  );
  resetListingVersionMemo();
  assert.ok(Number(await listingVersion(db)) > Number(version));
  assert.deepEqual(placeCacheTags({ placeId: PLACE_ID, citySlug: "london" }), [
    `place-${PLACE_ID}`,
    "cities",
    "guides",
    "sitemaps",
    "city-london",
  ]);
});

test("approving a place with a pin lists it on search, city and map at once", async () => {
  const { sqlite, db } = setup();
  sqlite
    .prepare(
      `INSERT INTO place_link_submissions (
        id, submitted_by_user_id, name, city_slug, street_address, source_url,
        google_place_id, status, status_reason, created_at, updated_at
      ) VALUES (?, 'submitter', 'QA TEST Pinned Cafe', 'london', '1 High Street',
        'https://maps.example/qa', NULL, 'pending', 'Waiting.', 10, 10)`,
    )
    .run(SUBMISSION_ID);

  // Warm the caches with the old directory, as a visitor would.
  assert.equal((await findPlaces({ q: "QA TEST", limit: 10 }, db)).places.length, 0);
  assert.equal((await findPlacesByCity("london", { limit: 60 }, db)).places.length, 0);

  const bad = await handleAdminReview(
    new Request(`https://halalfood.world/api/admin/review/place/${SUBMISSION_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved", lat: 200, lng: 0 }),
    }),
    { params: Promise.resolve({ kind: "place", id: SUBMISSION_ID }) },
    deps(db, "moderator"),
  );
  assert.equal(bad.status, 400);

  const response = await handleAdminReview(
    new Request(`https://halalfood.world/api/admin/review/place/${SUBMISSION_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved", lat: 51.5, lng: -0.1 }),
    }),
    { params: Promise.resolve({ kind: "place", id: SUBMISSION_ID }) },
    deps(db, "moderator"),
  );
  assert.equal(response.status, 200);
  const { placeId } = (await response.json()) as { placeId: string };
  resetListingVersionMemo(); // another isolate, after its memo window

  assert.deepEqual(
    (await findPlaces({ q: "QA TEST", limit: 10 }, db)).places.map((place) => place.id),
    [placeId],
  );
  assert.deepEqual(
    (await findPlacesByCity("london", { limit: 60 }, db)).places.map((place) => place.id),
    [placeId],
  );
  const map = await findPlaces({ bbox: { west: -1, south: 51, east: 1, north: 52 }, limit: 10 }, db);
  assert.deepEqual(
    map.places.map((place) => place.id),
    [placeId],
  );
});

test("a moderator can unpublish and restore a place; others cannot", async () => {
  const { sqlite, db } = setup();
  insertPlace(sqlite, PLACE_ID);

  assert.equal((await post(db, "diner", { action: "unpublish", reason: "x" })).status, 403);
  const signedOut = await handleAdminPlaceGet(
    new Request(`https://halalfood.world/api/admin/places/${PLACE_ID}`),
    { params: Promise.resolve({ id: PLACE_ID }) },
    { getAuth: async () => ({ status: "unauthenticated" as const }), database: db },
  );
  assert.equal(signedOut.status, 401);
  assert.equal((await post(db, "moderator", { action: "unpublish", reason: " " })).status, 400);

  assert.equal((await findPlaces({ q: "QA TEST", limit: 10 }, db)).places.length, 1);
  const hidden = await post(db, "moderator", { action: "unpublish", reason: "Closed down" });
  assert.equal(hidden.status, 200);
  const hiddenBody = (await hidden.json()) as { listing: { listingStatus: string; restorable: boolean } };
  assert.equal(hiddenBody.listing.listingStatus, "hidden");
  assert.equal(hiddenBody.listing.restorable, true);
  resetListingVersionMemo();
  assert.equal((await findPlaces({ q: "QA TEST", limit: 10 }, db)).places.length, 0);
  assert.equal((await findPlacesByCity("london", { limit: 60 }, db)).places.length, 0);
  assert.deepEqual(
    (await listModeratorHiddenPlaces(db)).map((place) => place.placeId),
    [PLACE_ID],
  );
  // Unpublishing twice is refused, not a second audit entry.
  assert.equal((await post(db, "moderator", { action: "unpublish", reason: "again" })).status, 409);

  const restored = await post(db, "moderator", { action: "restore" });
  assert.equal(restored.status, 200);
  resetListingVersionMemo();
  assert.equal((await findPlaces({ q: "QA TEST", limit: 10 }, db)).places.length, 1);
  assert.equal((await listModeratorHiddenPlaces(db)).length, 0);
  assert.equal((await post(db, "moderator", { action: "restore" })).status, 409);

  const actions = sqlite
    .prepare(`SELECT action, reason FROM audit_log WHERE target_id = ? ORDER BY created_at, rowid`)
    .all(PLACE_ID) as { action: string; reason: string | null }[];
  assert.deepEqual(
    actions.map((row) => row.action),
    ["place.unpublished", "place.restored"],
  );
  assert.equal(actions[0]!.reason, "Closed down");
});

test("restore never re-lists a place the listing rules hid (0022 alcohol-led venues)", async () => {
  const { sqlite, db } = setup();
  insertPlace(sqlite, RULE_HIDDEN_ID, { name: "Hidden Pub", status: "hidden" });
  const response = await post(db, "moderator", { action: "restore" }, RULE_HIDDEN_ID);
  assert.equal(response.status, 409);
  assert.match(((await response.json()) as { error: string }).error, /alcohol/);
  const row = sqlite
    .prepare(`SELECT listing_status FROM places WHERE id = ?`)
    .get(RULE_HIDDEN_ID) as { listing_status: string };
  assert.equal(row.listing_status, "hidden");
  assert.equal((await listModeratorHiddenPlaces(db)).length, 0);
});

test("a moderator can pin an unpinned place so it shows on the map", async () => {
  const { sqlite, db } = setup();
  insertPlace(sqlite, PLACE_ID);
  assert.equal((await post(db, "moderator", { action: "pin", lat: "abc", lng: 0 })).status, 400);
  const pinned = await post(db, "moderator", { action: "pin", lat: 51.51, lng: -0.12 });
  assert.equal(pinned.status, 200);
  resetListingVersionMemo();
  const map = await findPlaces({ bbox: { west: -1, south: 51, east: 1, north: 52 }, limit: 10 }, db);
  assert.deepEqual(
    map.places.map((place) => place.id),
    [PLACE_ID],
  );
});
