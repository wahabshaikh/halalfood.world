import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumePlaceRatingLimits,
  RATING_RATE_LIMITS,
  type OtpRateLimitStore,
} from "../src/lib/otp-rate-limit";
import {
  PLACE_RATING_VALUES,
  ratePlaceForUser,
  type PlaceRating,
  type PlaceRatingRepository,
  type PlaceRatingSnapshot,
  validatePlaceRatingInput,
} from "../src/lib/place-ratings";
import {
  handleRatingGet,
  handleRatingPut,
} from "../app/api/places/[id]/rating/route";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const USER_ID = "rater-123";
const AUTHENTICATED = async () => ({
  status: "authenticated" as const,
  userId: USER_ID,
});

function snapshot(
  rating: PlaceRating | null,
  counts: Partial<Record<PlaceRating, number>> & { total?: number } = {},
): PlaceRatingSnapshot {
  return {
    currentRating: rating,
    counts: {
      mashallah: counts.mashallah ?? 0,
      alhamdulillah: counts.alhamdulillah ?? 0,
      astaghfirullah: counts.astaghfirullah ?? 0,
      total:
        counts.total ??
        (counts.mashallah ?? 0) +
          (counts.alhamdulillah ?? 0) +
          (counts.astaghfirullah ?? 0),
    },
  };
}

test("rating validation accepts only the three halal reactions", () => {
  for (const rating of PLACE_RATING_VALUES)
    assert.deepEqual(validatePlaceRatingInput({ rating }), {
      ok: true,
      data: { rating },
    });
  assert.equal(validatePlaceRatingInput({ rating: "love-it" }).ok, false);
  assert.equal(validatePlaceRatingInput({}).ok, false);
  assert.equal(validatePlaceRatingInput(null).ok, false);
});

test("rating API rejects malformed place ids before checking auth", async () => {
  let authChecked = false;
  const response = await handleRatingPut(
    new Request("https://halalfood.world/api/places/not-a-place/rating", {
      method: "PUT",
    }),
    { params: Promise.resolve({ id: "not-a-place" }) },
    {
      getAuth: async () => {
        authChecked = true;
        return { status: "unauthenticated" };
      },
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid place id." });
  assert.equal(authChecked, false);
});

test("rating API rejects an invalid reaction without consuming a limit", async () => {
  let consumed = false;
  const response = await handleRatingPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/rating`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: "reviews" }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => {
        consumed = true;
        return { allowed: true, retryAfterMs: 0 };
      },
      repository: {
        async get() {
          return null;
        },
        async upsert() {
          return null;
        },
      },
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error:
      "Choose a halal reaction: mashallah, alhamdulillah, or astaghfirullah.",
  });
  assert.equal(consumed, false);
});

test("rating API returns a sign-in CTA before parsing an unauthenticated request", async () => {
  const response = await handleRatingPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/rating`, {
      method: "PUT",
      body: "not json",
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    { getAuth: async () => ({ status: "unauthenticated" }) },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Sign in to rate halal places.",
    loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${PLACE_ID}`)}`,
  });
});

test("rating limiter passes hashed user and IP buckets", async () => {
  let received: Parameters<OtpRateLimitStore["consume"]>[0] | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };

  await consumePlaceRatingLimits(USER_ID, "203.0.113.80", store, new Date(0));
  assert.ok(received);
  assert.match(received[0].key, /^place-rating:mutate:user:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^place-rating:mutate:ip:[0-9a-f]{64}$/);
  assert.doesNotMatch(received[0].key, new RegExp(USER_ID));
  assert.equal(
    received[0].rule.maxCount,
    RATING_RATE_LIMITS.mutationUser.maxCount,
  );
  assert.equal(
    received[1].rule.maxCount,
    RATING_RATE_LIMITS.mutationIp.maxCount,
  );
});

test("rating API writes an aggregate through the repository boundary", async () => {
  let created: { userId: string; placeId: string; rating: PlaceRating } | undefined;
  const repository: PlaceRatingRepository = {
    async get() {
      return null;
    },
    async upsert(userId, placeId, rating) {
      created = { userId, placeId, rating };
      return snapshot(rating, { [rating]: 1 });
    },
  };
  const response = await handleRatingPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/rating`, {
      method: "PUT",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.80" },
      body: JSON.stringify({ rating: "mashallah" }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      repository,
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(created, {
    userId: USER_ID,
    placeId: PLACE_ID,
    rating: "mashallah",
  });
  assert.deepEqual(await response.json(), {
    placeId: PLACE_ID,
    rating: "mashallah",
    counts: { mashallah: 1, alhamdulillah: 0, astaghfirullah: 0, total: 1 },
  });
});

test("rating GET returns aggregate counts and the signed-in user's reaction", async () => {
  let requestedUser: string | null = null;
  const response = await handleRatingGet(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/rating`),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      repository: {
        async get(placeId, userId) {
          requestedUser = userId;
          assert.equal(placeId, PLACE_ID);
          return snapshot("alhamdulillah", {
            mashallah: 2,
            alhamdulillah: 1,
            astaghfirullah: 3,
            total: 6,
          });
        },
        async upsert() {
          return null;
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(requestedUser, USER_ID);
  assert.deepEqual(await response.json(), {
    placeId: PLACE_ID,
    rating: "alhamdulillah",
    counts: { mashallah: 2, alhamdulillah: 1, astaghfirullah: 3, total: 6 },
  });
});

test("rating service upserts when a user changes their reaction", async () => {
  const ratings = new Map<string, PlaceRating>();
  const repository: PlaceRatingRepository = {
    async get(placeId, userId) {
      if (placeId !== PLACE_ID) return null;
      const rating = userId ? ratings.get(`${userId}:${placeId}`) ?? null : null;
      const counts = {
        mashallah: 0,
        alhamdulillah: 0,
        astaghfirullah: 0,
        total: ratings.size,
      };
      for (const value of ratings.values()) counts[value] += 1;
      return snapshot(rating, counts);
    },
    async upsert(userId, placeId, rating) {
      ratings.set(`${userId}:${placeId}`, rating);
      return this.get(placeId, userId);
    },
  };

  assert.deepEqual(
    await ratePlaceForUser(repository, USER_ID, PLACE_ID, "alhamdulillah"),
    {
      ok: true,
      snapshot: snapshot("alhamdulillah", {
        alhamdulillah: 1,
        total: 1,
      }),
    },
  );
  assert.deepEqual(
    await ratePlaceForUser(repository, USER_ID, PLACE_ID, "astaghfirullah"),
    {
      ok: true,
      snapshot: snapshot("astaghfirullah", {
        astaghfirullah: 1,
        total: 1,
      }),
    },
  );
  assert.equal(ratings.size, 1);
  assert.equal(ratings.get(`${USER_ID}:${PLACE_ID}`), "astaghfirullah");
});
