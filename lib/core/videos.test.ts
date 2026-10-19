import assert from "node:assert/strict";
import { test } from "vitest";
import {
  MAX_VIDEO_PLACES,
  VIDEO_META_TTL_MS,
  channelFromDataApi,
  creatorLinksFromText,
  isMetaFresh,
  metaFromOEmbed,
  needsReview,
  parsePlacePicks,
  parseVideoReview,
  videoFromDataApi,
  videoStatus,
} from "./videos";

const CHANNEL = "UC_x5XG1OV2P6uZZ5FSM9Ttw";
const place = (n: number) => `3f2504e0-4f89-11d3-9a0c-${String(n).padStart(12, "0")}`;

test("New and restricted members go to review; Member and above publish", () => {
  assert.equal(needsReview("restricted"), true);
  assert.equal(needsReview("new"), true);
  assert.equal(needsReview("member"), false);
  assert.equal(needsReview("trusted"), false);
  assert.equal(needsReview("moderator"), false);
});

test("cached meta is fresh for 30 days", () => {
  assert.equal(isMetaFresh(null, 1), false);
  assert.equal(isMetaFresh({ fetchedAt: 1000 }, 1000 + VIDEO_META_TTL_MS - 1), true);
  assert.equal(isMetaFresh({ fetchedAt: 1000 }, 1000 + VIDEO_META_TTL_MS), false);
});

test("oEmbed keeps the title, author, handle and a YouTube thumbnail", () => {
  assert.deepEqual(
    metaFromOEmbed({
      title: " Best biryani \u0007in Bandra ",
      author_name: "Halal Foodie",
      author_url: "https://www.youtube.com/@HalalFoodie",
      thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }),
    { title: "Best biryani in Bandra", authorName: "Halal Foodie", authorHandle: "halalfoodie", thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
  );
  assert.deepEqual(metaFromOEmbed({ author_url: "https://www.youtube.com/channel/x", thumbnail_url: "https://evil.example/x.jpg" }), {
    title: null,
    authorName: null,
    authorHandle: null,
    thumbnailUrl: null,
  });
  assert.deepEqual(metaFromOEmbed(null).title, null);
});

test("videos.list and channels.list bodies parse, and anything else is null", () => {
  assert.deepEqual(videoFromDataApi({ items: [{ snippet: { channelId: CHANNEL, description: "Noor Grill", publishedAt: "2026-10-01T10:00:00Z" } }] }), {
    channelId: CHANNEL,
    description: "Noor Grill",
    publishedAt: "2026-10-01",
  });
  assert.deepEqual(videoFromDataApi({ items: [{ snippet: { channelId: CHANNEL, publishedAt: "soon" } }] })?.publishedAt, null);
  assert.equal(videoFromDataApi({ items: [] }), null);
  assert.equal(videoFromDataApi("nope"), null);
  assert.deepEqual(
    channelFromDataApi({
      items: [
        {
          id: CHANNEL,
          snippet: { title: "Halal Foodie", description: "Food", customUrl: "@HalalFoodie", thumbnails: { high: { url: "https://yt3.ggpht.com/a.jpg" } } },
          statistics: { subscriberCount: "12000" },
          brandingSettings: { image: { bannerExternalUrl: "https://yt3.googleusercontent.com/b" } },
        },
      ],
    }),
    {
      channelId: CHANNEL,
      handle: "halalfoodie",
      title: "Halal Foodie",
      description: "Food",
      avatarUrl: "https://yt3.ggpht.com/a.jpg",
      bannerUrl: "https://yt3.googleusercontent.com/b",
      subscriberCount: 12000,
    },
  );
  const bare = channelFromDataApi({ items: [{ id: CHANNEL, statistics: { subscriberCount: "hidden" } }] });
  assert.equal(bare?.handle, null);
  assert.equal(bare?.subscriberCount, null);
  assert.equal(channelFromDataApi({ items: [{ id: "UC123" }] }), null);
});

test("socials come from the channel description, one per kind", () => {
  assert.deepEqual(
    creatorLinksFromText(
      "Follow me! https://instagram.com/halalfoodie, http://www.tiktok.com/@halalfoodie https://x.com/hf https://twitter.com/old\n" +
        "Shop: https://halalfoodie.example/shop. Subscribe https://youtube.com/@halalfoodie https://fb.com/hf https://user:pw@bad.example",
    ),
    [
      { kind: "instagram", url: "https://instagram.com/halalfoodie" },
      { kind: "tiktok", url: "https://www.tiktok.com/@halalfoodie" },
      { kind: "x", url: "https://x.com/hf" },
      { kind: "website", url: "https://halalfoodie.example/shop" },
      { kind: "facebook", url: "https://fb.com/hf" },
    ],
  );
  assert.deepEqual(creatorLinksFromText(null), []);
});

test("place picks are 1 to 10 valid place ids, deduped", () => {
  assert.deepEqual(parsePlacePicks({ placeIds: [place(1), place(1).toUpperCase(), place(2)] }), { ok: true, placeIds: [place(1), place(2)] });
  assert.equal(parsePlacePicks({ placeIds: [] }).ok, false);
  assert.equal(parsePlacePicks(null).ok, false);
  assert.equal(parsePlacePicks({ placeIds: ["nope"] }).ok, false);
  assert.equal(parsePlacePicks({ placeIds: Array.from({ length: MAX_VIDEO_PLACES + 1 }, (_, i) => place(i)) }).ok, false);
});

test("a video's status follows its places and its queue", () => {
  assert.equal(videoStatus({ published: 1, pending: 1, rejected: 1 }), "published");
  assert.equal(videoStatus({ published: 0, pending: 1, rejected: 1 }), "needs_review");
  assert.equal(videoStatus({ published: 0, pending: 0, rejected: 2 }), "rejected");
  assert.equal(videoStatus({ published: 0, pending: 0, rejected: 0 }), "fetched");
});

test("moderator decisions validate the member, action and bounded reason", () => {
  assert.equal(parseVideoReview(null).ok, false);
  assert.equal(parseVideoReview({ userId: " ", decision: "approve" }).ok, false);
  assert.equal(parseVideoReview({ userId: "a", decision: "remove" }).ok, false);
  assert.deepEqual(parseVideoReview({ userId: "a", decision: "approve" }), { ok: true, userId: "a", decision: "approve", reason: null });
  assert.deepEqual(parseVideoReview({ userId: "a", decision: "reject", reason: " x " }), { ok: true, userId: "a", decision: "reject", reason: "x" });
});
