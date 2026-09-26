import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchMediaMetadata,
  metadataFromOEmbed,
  normalizeHandle,
  oEmbedEndpoint,
  parseMediaUrl,
  type MediaLinkRepository,
} from "../src/lib/media-links";
import { handleMediaGet, handleMediaPost } from "../app/api/places/[id]/media/route";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const context = { params: Promise.resolve({ id: PLACE_ID }) };

test("parseMediaUrl normalises TikTok, YouTube and Instagram post links", () => {
  assert.deepEqual(parseMediaUrl("https://m.tiktok.com/@MidnightKebab/video/7312345678901234567?lang=en"), {
    platform: "tiktok",
    url: "https://www.tiktok.com/@midnightkebab/video/7312345678901234567",
    handle: "midnightkebab",
  });
  assert.deepEqual(parseMediaUrl("https://youtu.be/dQw4w9WgXcQ?t=42"), {
    platform: "youtube",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    handle: null,
  });
  assert.deepEqual(parseMediaUrl("https://www.youtube.com/shorts/abcDEF12345"), {
    platform: "youtube",
    url: "https://www.youtube.com/shorts/abcDEF12345",
    handle: null,
  });
  assert.deepEqual(parseMediaUrl("https://www.instagram.com/reels/C1a2B3c4D5e/?igsh=x"), {
    platform: "instagram",
    url: "https://www.instagram.com/reel/C1a2B3c4D5e/",
    handle: null,
  });
  assert.deepEqual(parseMediaUrl("https://vm.tiktok.com/ZMabc123/"), {
    platform: "tiktok",
    url: "https://vm.tiktok.com/ZMabc123/",
    handle: null,
  });
});

test("parseMediaUrl rejects profiles, other hosts and unsafe URLs", () => {
  for (const value of [
    "http://www.tiktok.com/@a/video/7312345678901234567",
    "https://www.tiktok.com/@someone",
    "https://www.youtube.com/@channel",
    "https://www.instagram.com/someone/",
    "https://tiktok.com.evil.example/@a/video/7312345678901234567",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    42,
  ])
    assert.equal(parseMediaUrl(value), null, String(value));
});

test("normalizeHandle lower-cases and strips @", () => {
  assert.equal(normalizeHandle("@Yusra.Eats"), "yusra.eats");
  assert.equal(normalizeHandle("not a handle"), null);
});

test("oEmbed metadata keeps safe fields and derives the handle", () => {
  assert.deepEqual(
    metadataFromOEmbed(
      "youtube",
      {
        author_name: "Two Forks",
        author_url: "https://www.youtube.com/@TwoForks",
        title: "Top 5 in E1",
        thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg",
      },
      null,
    ),
    {
      handle: "twoforks",
      authorName: "Two Forks",
      title: "Top 5 in E1",
      thumbnailUrl: "https://i.ytimg.com/vi/x/hqdefault.jpg",
    },
  );
  assert.deepEqual(
    metadataFromOEmbed(
      "tiktok",
      { author_unique_id: "Midnight.Kebab", thumbnail_url: "http://insecure.example/a.jpg" },
      null,
    ),
    { handle: "midnight.kebab", authorName: null, title: null, thumbnailUrl: null },
  );
  assert.equal(oEmbedEndpoint({ platform: "instagram", url: "https://www.instagram.com/p/x/", handle: null }), null);
});

test("fetchMediaMetadata falls back to the URL when oEmbed fails", async () => {
  const parsed = parseMediaUrl("https://www.tiktok.com/@ab/video/7312345678901234567")!;
  const metadata = await fetchMediaMetadata(parsed, (async () => {
    throw new Error("offline");
  }) as typeof fetch);
  assert.deepEqual(metadata, { handle: "ab", authorName: null, title: null, thumbnailUrl: null });
});

function repository(overrides: Partial<MediaLinkRepository> = {}): MediaLinkRepository {
  return {
    async hasPlace() {
      return true;
    },
    async list() {
      return [];
    },
    async create() {
      return true;
    },
    ...overrides,
  };
}

const allow = async () => ({ allowed: true as const, retryAfterMs: 0 });

test("media POST requires sign-in", async () => {
  const response = await handleMediaPost(
    new Request("https://halalfood.world/api/places/place-1/media", {
      method: "POST",
      body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    }),
    context,
    { getAuth: async () => ({ status: "unauthenticated" }), repository: repository() },
  );
  assert.equal(response.status, 401);
});

test("media POST rejects unsupported links before spending limits", async () => {
  let limited = false;
  const response = await handleMediaPost(
    new Request("https://halalfood.world/api/places/place-1/media", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/video" }),
    }),
    context,
    {
      getAuth: async () => ({ status: "authenticated", userId: "user-1" }),
      consumeLimits: (async () => {
        limited = true;
        return { allowed: true, retryAfterMs: 0 };
      }) as never,
      repository: repository(),
    },
  );
  assert.equal(response.status, 400);
  assert.equal(limited, false);
});

test("media POST stores the enriched link", async () => {
  const stored: unknown[] = [];
  const response = await handleMediaPost(
    new Request("https://halalfood.world/api/places/place-1/media", {
      method: "POST",
      body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    }),
    context,
    {
      getAuth: async () => ({ status: "authenticated", userId: "user-1" }),
      consumeLimits: allow as never,
      fetchMetadata: async () => ({
        handle: "twoforks",
        authorName: "Two Forks",
        title: "Top 5",
        thumbnailUrl: null,
      }),
      repository: repository({
        async create(userId, placeId, parsed, metadata) {
          stored.push({ userId, placeId, url: parsed.url, handle: metadata.handle });
          return true;
        },
      }),
    },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(stored, [
    {
      userId: "user-1",
      placeId: PLACE_ID,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      handle: "twoforks",
    },
  ]);
});

test("media GET returns 404 for unknown places", async () => {
  const response = await handleMediaGet(new Request("https://halalfood.world/x"), context, {
    repository: repository({
      async hasPlace() {
        return false;
      },
    }),
  });
  assert.equal(response.status, 404);
});
