import assert from "node:assert/strict";
import { test } from "vitest";
import { addPlace, addProfile, addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";
import { creatorVerifiedPlaces, getCreatorChannel, placeCreatorVerifications, profileHandleForChannel, videoMonth } from "./creator-profiles";
import { upsertCreator } from "./scout/creators";
import { addVerification } from "./scout/verifications";

const CHANNEL = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

async function seeded() {
  const t = createTestDatabase();
  const deps = { db: t.db, origin: "https://halalfood.world", now: () => Date.parse("2026-10-18T00:00:00Z") };
  await upsertCreator(deps, {
    handle: "@HalalFoodie",
    channel_id: CHANNEL,
    display_name: "Halal Foodie",
    avatar_url: "https://yt3.ggpht.com/a",
    banner_url: "https://yt3.googleusercontent.com/b",
    subscriber_count: 125_000,
  });
  const userId = (t.sqlite.prepare(`SELECT user_id FROM creator_profiles`).get() as { user_id: string }).user_id;
  const older = addPlace(t.sqlite, { name: "Tayyabs" });
  const newer = addPlace(t.sqlite, { name: "Dishoom" });
  const closed = addPlace(t.sqlite, { name: "Gone Grill", status: "closed" });
  await addVerification(deps, { creator: "halalfoodie", place_id: older, video_url: "dQw4w9WgXcQ", date: "2025-01-02" });
  await addVerification(deps, { creator: "halalfoodie", place_id: newer, video_url: "https://youtu.be/aaaaaaaaaaa", timestamp: 83, date: "2026-03-04" });
  t.sqlite
    .prepare(`INSERT INTO creator_verifications (id, creator_user_id, place_id, video_id, video_url, created_at, updated_at) VALUES ('c', ?, ?, 'bbbbbbbbbbb', 'x', 1, 1)`)
    .run(userId, closed);
  return { ...t, userId, older, newer, closed };
}

test("a creator's channel reads back, unclaimed until claimed", async () => {
  const { db, sqlite, userId } = await seeded();
  assert.deepEqual(await getCreatorChannel(userId, db), {
    platform: "youtube",
    channelId: CHANNEL,
    channelHandle: "halalfoodie",
    channelUrl: "https://www.youtube.com/@halalfoodie",
    avatarUrl: "https://yt3.ggpht.com/a",
    bannerUrl: "https://yt3.googleusercontent.com/b",
    subscriberCount: 125_000,
    claimed: false,
  });
  sqlite.prepare(`UPDATE creator_profiles SET claimed_at = 1`).run();
  assert.equal((await getCreatorChannel(userId, db))?.claimed, true);
  addUser(sqlite, "person");
  assert.equal(await getCreatorChannel("person", db), null);
});

test("verified places list listed places only, newest video first, with timestamped links", async () => {
  const { db, userId, older, newer } = await seeded();
  const places = await creatorVerifiedPlaces(userId, 48, db);
  assert.deepEqual(
    places.map((place) => [place.placeId, place.videoUrl, place.videoDate]),
    [
      [newer, "https://www.youtube.com/watch?v=aaaaaaaaaaa&t=83s", "2026-03-04"],
      [older, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "2025-01-02"],
    ],
  );
  assert.deepEqual(places[0]!.status, { kind: "unchecked" });
});

test("a place lists the creators who showed it, without suspended profiles", async () => {
  const { db, sqlite, newer } = await seeded();
  const creators = await placeCreatorVerifications(newer, db);
  assert.equal(creators.length, 1);
  assert.deepEqual({ ...creators[0], id: "x" }, {
    id: "x",
    handle: "halalfoodie",
    displayName: "Halal Foodie",
    avatarUrl: "https://yt3.ggpht.com/a",
    videoUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa&t=83s",
    timestampSeconds: 83,
    videoDate: "2026-03-04",
  });
  sqlite.prepare(`UPDATE profiles SET suspended_at = 1`).run();
  assert.deepEqual(await placeCreatorVerifications(newer, db), []);
  assert.equal(await profileHandleForChannel("youtube", "halalfoodie", db), null);
});

test("the creator page finds the profile for a YouTube channel handle", async () => {
  const { db, sqlite } = await seeded();
  assert.equal(await profileHandleForChannel("youtube", "HalalFoodie", db), "halalfoodie");
  assert.equal(await profileHandleForChannel("tiktok", "halalfoodie", db), null);
  addUser(sqlite, "other");
  addProfile(sqlite, "other", { handle: "someone" });
  assert.equal(await profileHandleForChannel("youtube", "someone", db), null);
});

test("video months read like a date", () => {
  assert.equal(videoMonth("2026-03-04"), "Mar 2026");
  assert.equal(videoMonth("2026-09-01"), "Sep 2026");
  assert.equal(videoMonth("2026-13-01"), null);
  assert.equal(videoMonth(null), null);
  assert.equal(videoMonth("nope"), null);
});
