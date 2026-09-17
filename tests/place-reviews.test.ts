import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumePlaceReviewLimits,
  REVIEW_RATE_LIMITS,
  type OtpRateLimitStore,
} from "../src/lib/otp-rate-limit";
import {
  PLACE_REVIEW_BODY_MAX_LENGTH,
  PLACE_REVIEW_MAX_PAYLOAD_BYTES,
  PLACE_REVIEW_TITLE_MAX_LENGTH,
  deletePlaceReviewForUser,
  d1PlaceReviewRepository,
  savePlaceReviewForUser,
  type PlaceReview,
  type PlaceReviewInput,
  type PlaceReviewRepository,
  validatePlaceReviewInput,
} from "../src/lib/place-reviews";
import {
  handleReviewDelete,
  handleReviewGet,
  handleReviewPut,
} from "../app/api/places/[id]/reviews/route";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const USER_ID = "reviewer-123";
const OTHER_USER_ID = "reviewer-456";
const AUTHENTICATED = async () => ({
  status: "authenticated" as const,
  userId: USER_ID,
});

function review(overrides: Partial<PlaceReview> = {}): PlaceReview {
  return {
    authorDisplayName: "Amina",
    title: null,
    body: "The food was fresh and the halal options were clearly explained.",
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    isOwn: false,
    ...overrides,
  };
}

function repositoryFor(
  initial: Array<{ userId: string; placeId: string; input: PlaceReviewInput }> = [],
): PlaceReviewRepository {
  const entries = new Map(
    initial.map((entry) => [
      `${entry.userId}:${entry.placeId}`,
      { ...entry.input },
    ]),
  );
  return {
    async hasPlace(placeId) {
      return placeId === PLACE_ID;
    },
    async list(placeId, userId) {
      return [...entries.entries()]
        .filter(([key]) => key.endsWith(`:${placeId}`))
        .map(([key, input], index) => {
          const [entryUserId] = key.split(":");
          return review({
            ...input,
            createdAt: `2026-09-14T${String(10 - index).padStart(2, "0")}:00:00.000Z`,
            updatedAt: `2026-09-14T${String(10 - index).padStart(2, "0")}:00:00.000Z`,
            isOwn: entryUserId === userId,
          });
        });
    },
    async upsert(userId, placeId, input) {
      if (placeId !== PLACE_ID) return false;
      entries.set(`${userId}:${placeId}`, input);
      return true;
    },
    async delete(userId, placeId) {
      return entries.delete(`${userId}:${placeId}`);
    },
  };
}

test("review validation trims input and accepts an optional title", () => {
  assert.deepEqual(
    validatePlaceReviewInput({
      title: "  Worth a visit  ",
      body: "  The staff explained the halal menu carefully.  ",
    }),
    {
      ok: true,
      data: {
        title: "Worth a visit",
        body: "The staff explained the halal menu carefully.",
      },
    },
  );
  assert.deepEqual(validatePlaceReviewInput({ body: "A title is optional." }), {
    ok: true,
    data: { title: null, body: "A title is optional." },
  });
});

test("review validation rejects an empty body and oversized fields", () => {
  assert.equal(validatePlaceReviewInput({ body: "   \n\t" }).ok, false);
  assert.equal(
    validatePlaceReviewInput({ body: "x".repeat(PLACE_REVIEW_BODY_MAX_LENGTH + 1) }).ok,
    false,
  );
  assert.equal(
    validatePlaceReviewInput({
      title: "x".repeat(PLACE_REVIEW_TITLE_MAX_LENGTH + 1),
      body: "A valid body.",
    }).ok,
    false,
  );
  assert.equal(validatePlaceReviewInput({ title: 42, body: "A valid body." }).ok, false);
  assert.equal(validatePlaceReviewInput(null).ok, false);
});

test("review API rejects malformed place ids before checking auth", async () => {
  let authChecked = false;
  const response = await handleReviewPut(
    new Request("https://halalfood.world/api/places/not-a-place/reviews", {
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

test("review mutations return a sign-in CTA before parsing an unauthenticated request", async () => {
  const response = await handleReviewPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`, {
      method: "PUT",
      body: "not json",
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    { getAuth: async () => ({ status: "unauthenticated" }) },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Sign in to share a halal review.",
    loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${PLACE_ID}`)}`,
  });
});

test("invalid review input does not consume a mutation limit", async () => {
  let consumed = false;
  const response = await handleReviewPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "   " }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => {
        consumed = true;
        return { allowed: true, retryAfterMs: 0 };
      },
      repository: repositoryFor(),
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Review body is required." });
  assert.equal(consumed, false);
});

test("oversized review payloads are rejected before consuming a mutation limit", async () => {
  let consumed = false;
  const response = await handleReviewPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "x".repeat(PLACE_REVIEW_BODY_MAX_LENGTH),
        extra: "x".repeat(PLACE_REVIEW_MAX_PAYLOAD_BYTES),
      }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => {
        consumed = true;
        return { allowed: true, retryAfterMs: 0 };
      },
      repository: repositoryFor(),
    },
  );
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Review request is too large." });
  assert.equal(consumed, false);
});

test("valid maximum-length Unicode reviews fit the transport guard", async () => {
  const response = await handleReviewPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "🙂".repeat(PLACE_REVIEW_BODY_MAX_LENGTH) }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      repository: repositoryFor(),
    },
  );
  assert.equal(response.status, 200);
});

test("review limiter passes hashed user and IP buckets", async () => {
  let received: Parameters<OtpRateLimitStore["consume"]>[0] | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };

  await consumePlaceReviewLimits(USER_ID, "203.0.113.80", store, new Date(0));
  assert.ok(received);
  assert.match(received[0].key, /^place-review:mutate:user:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^place-review:mutate:ip:[0-9a-f]{64}$/);
  assert.doesNotMatch(received[0].key, new RegExp(USER_ID));
  assert.equal(received[0].rule.maxCount, REVIEW_RATE_LIMITS.mutationUser.maxCount);
  assert.equal(received[1].rule.maxCount, REVIEW_RATE_LIMITS.mutationIp.maxCount);
});

test("review API writes through the repository and returns the trimmed review", async () => {
  let received: { userId: string; placeId: string; input: PlaceReviewInput } | undefined;
  const response = await handleReviewPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  Lunch  ", body: "  A helpful visit.  " }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      repository: {
        ...repositoryFor(),
        async upsert(userId, placeId, input) {
          received = { userId, placeId, input };
          return true;
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    userId: USER_ID,
    placeId: PLACE_ID,
    input: { title: "Lunch", body: "A helpful visit." },
  });
  assert.deepEqual(await response.json(), {
    placeId: PLACE_ID,
    review: { title: "Lunch", body: "A helpful visit." },
  });
});

test("review service upserts one row per user and place", async () => {
  const entries = new Map<string, PlaceReviewInput>();
  const repository: PlaceReviewRepository = {
    async hasPlace() {
      return true;
    },
    async list() {
      return [];
    },
    async upsert(userId, placeId, input) {
      entries.set(`${userId}:${placeId}`, input);
      return true;
    },
    async delete() {
      return false;
    },
  };

  assert.deepEqual(
    await savePlaceReviewForUser(repository, USER_ID, PLACE_ID, {
      title: null,
      body: "First version.",
    }),
    { ok: true },
  );
  assert.deepEqual(
    await savePlaceReviewForUser(repository, USER_ID, PLACE_ID, {
      title: "Updated",
      body: "Second version.",
    }),
    { ok: true },
  );
  assert.equal(entries.size, 1);
  assert.deepEqual(entries.get(`${USER_ID}:${PLACE_ID}`), {
    title: "Updated",
    body: "Second version.",
  });
});

test("delete removes only the authenticated user's review", async () => {
  const entries = new Set([`${USER_ID}:${PLACE_ID}`, `${OTHER_USER_ID}:${PLACE_ID}`]);
  const repository: PlaceReviewRepository = {
    async hasPlace() {
      return true;
    },
    async list() {
      return [];
    },
    async upsert() {
      return true;
    },
    async delete(userId, placeId) {
      return entries.delete(`${userId}:${placeId}`);
    },
  };

  assert.deepEqual(await deletePlaceReviewForUser(repository, USER_ID, PLACE_ID), {
    ok: true,
  });
  assert.equal(entries.has(`${USER_ID}:${PLACE_ID}`), false);
  assert.equal(entries.has(`${OTHER_USER_ID}:${PLACE_ID}`), true);
  assert.deepEqual(await deletePlaceReviewForUser(repository, "missing-user", PLACE_ID), {
    ok: false,
    reason: "not-found",
  });
});

test("review delete cannot target another user's row", async () => {
  let deletedUserId = "";
  const response = await handleReviewDelete(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      repository: {
        ...repositoryFor(),
        async delete(userId) {
          deletedUserId = userId;
          return false;
        },
      },
    },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Your halal review could not be found." });
  assert.equal(deletedUserId, USER_ID);
});

test("public review GET returns newest-first reviews and current-user ownership", async () => {
  const reviews = [
    review({
      title: "Recent",
      body: "Newest halal review.",
      createdAt: "2026-09-14T12:00:00.000Z",
      updatedAt: "2026-09-14T12:00:00.000Z",
      isOwn: true,
    }),
    review({
      title: null,
      body: "Earlier halal review.",
      createdAt: "2026-09-13T12:00:00.000Z",
      updatedAt: "2026-09-13T12:00:00.000Z",
    }),
  ];
  const response = await handleReviewGet(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      repository: {
        ...repositoryFor(),
        async list(placeId, userId) {
          assert.equal(placeId, PLACE_ID);
          assert.equal(userId, USER_ID);
          return reviews;
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { placeId: PLACE_ID, reviews });
});

test("review GET does not publicly cache an ownership-shaped response", async () => {
  const response = await handleReviewGet(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: async () => ({ status: "unauthenticated" }),
      repository: repositoryFor(),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("D1 review listing keeps an authenticated user's older review beyond the recent cap", async () => {
  const recentRows = Array.from({ length: 50 }, (_, index) => ({
    author_display_name: `Visitor ${index}`,
    title: null,
    body: `Recent review ${index}`,
    created_at: `2026-09-${String(14 - Math.floor(index / 5)).padStart(2, "0")}T${String(23 - (index % 5)).padStart(2, "0")}:00:00.000Z`,
    updated_at: `2026-09-${String(14 - Math.floor(index / 5)).padStart(2, "0")}T${String(23 - (index % 5)).padStart(2, "0")}:00:00.000Z`,
    is_own: false,
  }));
  let calls = 0;
  const client = {
    async all() {
      calls += 1;
      return calls === 1
        ? recentRows
        : [
            {
              author_display_name: "Older owner",
              title: "My visit",
              body: "The older review still belongs to me.",
              created_at: "2026-01-01T10:00:00.000Z",
              updated_at: "2026-01-01T10:00:00.000Z",
              is_own: true,
            },
          ];
    },
  };
  const repository = d1PlaceReviewRepository(client as never);
  const reviews = await repository.list(PLACE_ID, USER_ID);
  assert.equal(calls, 2);
  assert.equal(reviews.length, 51);
  assert.equal(reviews.at(-1)?.isOwn, true);
  assert.equal(reviews.at(-1)?.body, "The older review still belongs to me.");
});

test("rate-limited review mutation does not write", async () => {
  let written = false;
  const response = await handleReviewPut(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/reviews`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "A valid review." }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => ({ allowed: false, retryAfterMs: 5000 }),
      repository: {
        ...repositoryFor(),
        async upsert() {
          written = true;
          return true;
        },
      },
    },
  );
  assert.equal(response.status, 429);
  assert.equal(written, false);
  assert.equal(response.headers.get("Retry-After"), "5");
});
