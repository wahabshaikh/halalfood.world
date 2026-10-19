import assert from "node:assert/strict";
import { test } from "vitest";
import { consumeVideoPasteLimits, d1OtpRateLimitStore } from "./otp-rate-limit";
import { getCreatorLinks } from "./creator-profiles";
import { upsertCreator } from "./scout/creators";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { listVideoQueue, memberTier, pasteVideo, reviewVideo, submitVideoPlaces, type VideoDeps } from "./videos";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const VIDEO = "dQw4w9WgXcQ";
const CHANNEL = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

/** A fake YouTube: oEmbed, videos.list and channels.list, counting every call. */
function youtube(options: { oembed?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://www.youtube.com/oembed"))
      return options.oembed === false
        ? new Response("Not Found", { status: 404 })
        : body({
            title: "Noor Grill House: best kebabs in Bandra",
            author_name: "Halal Foodie",
            author_url: "https://www.youtube.com/@halalfoodie",
            thumbnail_url: `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`,
          });
    if (url.includes("/youtube/v3/videos"))
      return body({ items: [{ snippet: { channelId: CHANNEL, description: "We tried Noor Grill House.", publishedAt: "2026-10-01T09:00:00Z" } }] });
    if (url.includes("/youtube/v3/channels"))
      return body({
        items: [
          {
            id: CHANNEL,
            snippet: {
              title: "Halal Foodie",
              description: "Halal eats. Insta: https://instagram.com/halalfoodie",
              customUrl: "@halalfoodie",
              thumbnails: { high: { url: "https://yt3.ggpht.com/avatar.jpg" } },
            },
            statistics: { subscriberCount: "52000" },
          },
        ],
      });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetcher, calls };
}

function world(options: { key?: string | null; oembed?: boolean } = {}) {
  const test = createTestDatabase();
  const { sqlite } = test;
  for (const id of ["newbie", "member", "member2", "mod"]) {
    addUser(sqlite, id, id, NOW - 60 * DAY);
    addProfile(sqlite, id);
  }
  sqlite.prepare(`INSERT INTO member_trust (user_id, tier, weight, updated_at) VALUES ('member', 'member', 1, ?), ('member2', 'member', 1, ?)`).run(NOW, NOW);
  sqlite.prepare(`INSERT INTO moderators (user_id, created_at) VALUES ('mod', 1)`).run();
  const noor = addPlace(sqlite, { name: "Noor Grill House" });
  const other = addPlace(sqlite, { name: "Bombay Biryani" });
  const yt = youtube({ oembed: options.oembed });
  let clock = NOW;
  const deps: VideoDeps = {
    db: test.db,
    origin: "https://halalfood.world",
    now: () => clock,
    youtubeKey: options.key === undefined ? "test-key" : options.key,
    fetcher: yt.fetcher,
  };
  const one = <T>(query: string, ...args: (string | number)[]) => ({ ...(sqlite.prepare(query).get(...args) as object) }) as T;
  const all = <T>(query: string, ...args: (string | number)[]) => sqlite.prepare(query).all(...args).map((row) => ({ ...row })) as T[];
  const points = (userId: string) => one<{ n: number }>(`SELECT coalesce(sum(points), 0) AS n FROM contribution_points WHERE user_id = ? AND status = 'granted'`, userId).n;
  const verifications = () => all<{ place_id: string; source: string }>(`SELECT place_id, source FROM creator_verifications ORDER BY place_id`);
  const trust = (placeId: string) => one<{ badges: string; creator_count: number }>(`SELECT badges, creator_count FROM place_status WHERE place_id = ?`, placeId);
  return { ...test, deps, yt, noor, other, one, all, points, verifications, trust, tick: (ms: number) => (clock += ms) };
}

test("the first paste fetches oEmbed, videos.list and channels.list once and creates the creator with socials", async () => {
  const { deps, yt, one, all, noor } = world();
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  assert.equal(yt.calls.length, 3, "oEmbed + 2 Data API units");
  assert.ok(yt.calls[1].includes("key=test-key"));
  assert.equal(pasted.value.status, "fetched");
  assert.equal(pasted.value.creator?.handle, "halalfoodie");
  assert.equal(pasted.value.creator?.avatarUrl, "https://yt3.ggpht.com/avatar.jpg");
  assert.equal(pasted.value.meta.publishedAt, "2026-10-01");
  assert.deepEqual(pasted.value.suggestions.map((place) => place.id), [noor]);
  assert.equal(one<{ source: string }>(`SELECT source FROM creator_profiles WHERE channel_id = ?`, CHANNEL).source, "member");
  assert.deepEqual(all(`SELECT kind, url, source FROM creator_links ORDER BY kind`), [
    { kind: "instagram", url: "https://instagram.com/halalfoodie", source: "youtube_about" },
    { kind: "youtube", url: "https://www.youtube.com/@halalfoodie", source: "youtube_about" },
  ]);
});

test("later pastes of the same video read the cache: one row, no fetch, until 30 days pass", async () => {
  const { deps, yt, one, tick } = world();
  const first = await pasteVideo("member", VIDEO, deps);
  const second = await pasteVideo("newbie", VIDEO, deps);
  assert.ok(first.ok && second.ok);
  assert.equal(second.value.id, first.value.id);
  assert.equal(yt.calls.length, 3);
  assert.equal(one<{ n: number }>(`SELECT count(*) AS n FROM video_submissions`).n, 1);
  tick(31 * DAY);
  await pasteVideo("newbie", VIDEO, deps);
  assert.equal(yt.calls.length, 6);
  assert.equal(one<{ n: number }>(`SELECT count(*) AS n FROM video_submissions`).n, 1);
});

test("without YOUTUBE_API_KEY only oEmbed is read, and only a known creator matches", async () => {
  const { deps, yt } = world({ key: null });
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  assert.equal(yt.calls.length, 1);
  assert.equal(pasted.value.creator, null);
  const sent = await submitVideoPlaces("member", pasted.value.id, [world().noor], deps);
  assert.deepEqual(sent, { ok: false, status: 409, error: "We couldn’t tell whose channel this is, so it can’t verify places yet." });
});

test("a video oEmbed can't read is not cached", async () => {
  const { deps, one } = world({ oembed: false });
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.equal(pasted.ok, false);
  assert.equal(one<{ n: number }>(`SELECT count(*) AS n FROM video_submissions`).n, 0);
});

test("a Member's picks publish at once: Creator verified, trust recomputed, 5 + 2 per place", async () => {
  const { deps, noor, other, verifications, trust, points, one } = world();
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  const sent = await submitVideoPlaces("member", pasted.value.id, [noor, other], deps);
  assert.deepEqual(sent, { ok: true, value: { status: "published", published: [noor, other], points: 9 } });
  assert.deepEqual(verifications().map((row) => row.source), ["member", "member"]);
  assert.equal(trust(noor).badges, "creator_verified");
  assert.equal(trust(noor).creator_count, 1);
  assert.equal(points("member"), 9);
  const video = one<{ status: string; place_ids: string }>(`SELECT status, place_ids FROM video_submissions`);
  assert.equal(video.status, "published");
  assert.deepEqual(JSON.parse(video.place_ids), [noor, other]);
  assert.equal(one<{ n: number }>(`SELECT count(*) AS n FROM contributions WHERE kind = 'video' AND status = 'accepted'`).n, 2);
});

test("a second submitter adds only contributions: no duplicate video or verification, and no points for nothing new", async () => {
  const { deps, noor, other, verifications, points, one } = world();
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  await submitVideoPlaces("member", pasted.value.id, [noor], deps);
  const again = await submitVideoPlaces("member2", pasted.value.id, [noor], deps);
  assert.deepEqual(again, { ok: true, value: { status: "published", published: [], points: 0 } });
  assert.equal(verifications().length, 1);
  assert.equal(points("member2"), 0);
  const more = await submitVideoPlaces("member2", pasted.value.id, [other], deps);
  assert.ok(more.ok);
  assert.equal(more.value.points, 7);
  assert.equal(one<{ n: number }>(`SELECT count(*) AS n FROM video_submissions`).n, 1);
  // Re-sending the same picks is refused, and a member is paid once per video.
  assert.equal((await submitVideoPlaces("member2", pasted.value.id, [other], deps)).ok, false);
});

test("a New member's picks queue for review, pay nothing, and publish with points when a moderator approves", async () => {
  const { deps, noor, verifications, points, one } = world();
  assert.equal(await memberTier(deps.db, "newbie", NOW), "new");
  const pasted = await pasteVideo("newbie", VIDEO, deps);
  assert.ok(pasted.ok);
  const sent = await submitVideoPlaces("newbie", pasted.value.id, [noor], deps);
  assert.deepEqual(sent, { ok: true, value: { status: "needs_review", published: [], points: 0 } });
  assert.equal(verifications().length, 0);
  assert.equal(points("newbie"), 0);
  assert.equal(one<{ status: string }>(`SELECT status FROM video_submissions`).status, "needs_review");
  const queue = await listVideoQueue(deps.db);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].handle, "newbie");
  assert.equal(queue[0].creatorHandle, "halalfoodie");
  assert.deepEqual(queue[0].places, [{ id: noor, name: "Noor Grill House" }]);

  const approved = await reviewVideo("mod", pasted.value.id, "newbie", "approve", null, deps);
  assert.deepEqual(approved, { ok: true, value: { published: [noor], points: 7 } });
  assert.equal(verifications().length, 1);
  assert.equal(points("newbie"), 7);
  assert.equal(one<{ reviewed_by: string }>(`SELECT reviewed_by FROM contributions WHERE kind = 'video'`).reviewed_by, "mod");
  assert.equal(one<{ action: string }>(`SELECT action FROM audit_log WHERE target_type = 'video_submission'`).action, "video-approve");
  assert.equal(one<{ status: string }>(`SELECT status FROM video_submissions`).status, "published");
  assert.equal((await listVideoQueue(deps.db)).length, 0);
  assert.equal((await reviewVideo("mod", pasted.value.id, "newbie", "approve", null, deps)).ok, false);
});

test("a rejected video publishes nothing, pays nothing and records the reason", async () => {
  const { deps, noor, verifications, points, one } = world();
  const pasted = await pasteVideo("newbie", VIDEO, deps);
  assert.ok(pasted.ok);
  await submitVideoPlaces("newbie", pasted.value.id, [noor], deps);
  const rejected = await reviewVideo("mod", pasted.value.id, "newbie", "reject", "Not this place.", deps);
  assert.ok(rejected.ok);
  assert.equal(verifications().length, 0);
  assert.equal(points("newbie"), 0);
  assert.deepEqual(one(`SELECT status, reason FROM contributions WHERE kind = 'video'`), { status: "rejected", reason: "Not this place." });
  assert.equal(one<{ status: string }>(`SELECT status FROM video_submissions`).status, "rejected");
});

test("10 videos a day per member; adding places to a video already sent today doesn't count again", async () => {
  const { deps, sqlite, noor, other } = world();
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  for (let n = 0; n < 9; n++)
    sqlite
      .prepare(`INSERT INTO contributions (id, user_id, kind, place_id, ref_table, ref_id, channel, status, created_at) VALUES (?, 'member', 'video', ?, 'video_submissions', ?, 'web', 'accepted', ?)`)
      .run(crypto.randomUUID(), noor, `other-video-${n}`, NOW - 1000);
  assert.ok((await submitVideoPlaces("member", pasted.value.id, [noor], deps)).ok);
  assert.ok((await submitVideoPlaces("member", pasted.value.id, [other], deps)).ok, "the same video again");
  sqlite
    .prepare(`INSERT INTO video_submissions (id, video_id, url, status, creator_user_id, meta, created_at, updated_at) SELECT ?, 'abcdefghijk', url, 'fetched', creator_user_id, meta, created_at, updated_at FROM video_submissions`)
    .run("11111111-2222-3333-4444-555555555555");
  const limited = await submitVideoPlaces("member", "11111111-2222-3333-4444-555555555555", [noor], deps);
  assert.deepEqual(limited, { ok: false, status: 429, error: "You’ve sent a lot of videos today. Please try again tomorrow." });
});

test("video points stop at the 100 points a day cap", async () => {
  const { deps, sqlite, noor, points } = world();
  sqlite
    .prepare(`INSERT INTO contributions (id, user_id, kind, ref_table, ref_id, channel, status, created_at) VALUES ('c0', 'member', 'vouch', 'vouches', 'x', 'web', 'accepted', ?)`)
    .run(NOW);
  sqlite
    .prepare(`INSERT INTO contribution_points (id, user_id, contribution_id, kind, points, status, day, created_at) VALUES ('p0', 'member', 'c0', 'vouch', 96, 'granted', '2026-10-18', ?)`)
    .run(NOW);
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  const sent = await submitVideoPlaces("member", pasted.value.id, [noor], deps);
  assert.ok(sent.ok);
  assert.equal(sent.value.points, 4);
  assert.equal(points("member"), 100);
});

test("unknown places and videos are refused", async () => {
  const { deps } = world();
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  assert.equal((await submitVideoPlaces("member", pasted.value.id, ["3f2504e0-4f89-11d3-9a0c-999999999999"], deps)).ok, false);
  const missing = await submitVideoPlaces("member", "11111111-2222-3333-4444-555555555555", ["3f2504e0-4f89-11d3-9a0c-999999999999"], deps);
  assert.equal(missing.ok || missing.status, 404);
  assert.equal(await memberTier(deps.db, "nobody", NOW), "restricted");
  assert.equal(await memberTier(deps.db, "mod", NOW), "moderator");
});

test("parallel first pastes spend one metadata fetch and reserve one row", async () => {
  const { deps, yt, one } = world();
  const results = await Promise.all([pasteVideo("member", VIDEO, deps), pasteVideo("member2", VIDEO, deps)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(yt.calls.length, 3);
  assert.equal(one<{ n: number }>(`SELECT count(*) AS n FROM video_submissions`).n, 1);
});

test("a failed Data API response stays cached rather than spending units on each paste", async () => {
  const { deps, yt } = world();
  const fetcher = deps.fetcher!;
  let apiCalls = 0;
  deps.fetcher = (async (input, init) => {
    if (String(input).includes("googleapis.com")) {
      apiCalls++;
      return new Response("quota", { status: 403 });
    }
    return fetcher(input, init);
  }) as typeof fetch;
  assert.ok((await pasteVideo("member", VIDEO, deps)).ok);
  assert.ok((await pasteVideo("member2", VIDEO, deps)).ok);
  assert.equal(apiCalls, 1);
  assert.equal(yt.calls.length, 1);
});

test("without a key an existing creator is matched and can publish", async () => {
  const { deps, yt, noor } = world({ key: null });
  await upsertCreator(deps, { handle: "halalfoodie", channel_id: CHANNEL, display_name: "Foodie" });
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok && pasted.value.creator);
  assert.equal(yt.calls.length, 1);
  const sent = await submitVideoPlaces("member", pasted.value.id, [noor], deps);
  assert.ok(sent.ok);
  assert.equal(sent.value.points, 7);
});

test("additional published places pay 2 points without repeating the base award", async () => {
  const { deps, noor, other, points } = world();
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  await submitVideoPlaces("member", pasted.value.id, [noor], deps);
  const more = await submitVideoPlaces("member", pasted.value.id, [other], deps);
  assert.ok(more.ok);
  assert.equal(more.value.points, 2);
  assert.equal(points("member"), 9);
});

test("member video submissions can reference a claimed creator without changing their profile", async () => {
  const { deps, sqlite, noor, points } = world();
  const pasted = await pasteVideo("member", VIDEO, deps);
  assert.ok(pasted.ok);
  sqlite.prepare(`UPDATE creator_profiles SET claimed_at = 1`).run();
  const sent = await submitVideoPlaces("member", pasted.value.id, [noor], deps);
  assert.ok(sent.ok);
  assert.equal(points("member"), 7);
  assert.deepEqual((await getCreatorLinks(pasted.value.creator!.userId, deps.db)).map((link) => ({ ...link })), [{ kind: "instagram", url: "https://instagram.com/halalfoodie" }]);
});

test("paste quota blocks the eleventh attempt durably and resets after a day", async () => {
  const { db } = world();
  const store = d1OtpRateLimitStore(db);
  for (let n = 0; n < 10; n++)
    assert.equal((await consumeVideoPasteLimits("member", "127.0.0.1", store, new Date(NOW))).allowed, true);
  assert.equal((await consumeVideoPasteLimits("member", "127.0.0.1", store, new Date(NOW))).allowed, false);
  assert.equal((await consumeVideoPasteLimits("member2", "127.0.0.1", store, new Date(NOW))).allowed, true);
  assert.equal((await consumeVideoPasteLimits("member", "127.0.0.1", store, new Date(NOW + DAY + 1))).allowed, true);
});
