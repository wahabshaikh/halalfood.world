import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeSavePlaceLimits,
  SAVE_RATE_LIMITS,
  type OtpRateLimitStore,
} from "../src/lib/otp-rate-limit";
import {
  savePlaceForUser,
  unsavePlaceForUser,
  type SavedPlaceRepository,
} from "../src/lib/saved-places";
import { placeIdParam } from "../src/lib/params";
import { POST as savePlacePost } from "../app/api/places/[id]/saved/route";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("saved place API ids use the existing UUID validation", () => {
  assert.equal(placeIdParam(PLACE_ID.toUpperCase()), PLACE_ID);
  assert.equal(placeIdParam("not-a-place"), null);
  assert.equal(placeIdParam("3f2504e0-4f89-11d3-9a0c-0305e82c3301x"), null);
});

test("save mutation rejects malformed ids without touching auth or the database", async () => {
  const response = await savePlacePost(
    new Request("https://halalfood.world/api/places/not-a-place/saved", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "not-a-place" }) },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid place id." });
});

test("save limiter passes hashed user and IP buckets", async () => {
  let received: Parameters<OtpRateLimitStore["consume"]>[0] | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };

  await consumeSavePlaceLimits("user-123", "203.0.113.10", store, new Date(0));
  assert.ok(received);
  assert.match(received[0].key, /^saved-place:mutate:user:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^saved-place:mutate:ip:[0-9a-f]{64}$/);
  assert.doesNotMatch(received[0].key, /user-123/);
  assert.equal(
    received[0].rule.maxCount,
    SAVE_RATE_LIMITS.mutationUser.maxCount,
  );
  assert.equal(
    received[1].rule.maxCount,
    SAVE_RATE_LIMITS.mutationIp.maxCount,
  );
});

test("save and unsave service handles the happy path without a database", async () => {
  const saved = new Set<string>();
  const repository: SavedPlaceRepository = {
    async hasPlace(placeId) {
      return placeId === PLACE_ID;
    },
    async add(userId, placeId) {
      saved.add(`${userId}:${placeId}`);
    },
    async remove(userId, placeId) {
      saved.delete(`${userId}:${placeId}`);
    },
    async list() {
      return { places: [], total: 0, limit: 200 };
    },
  };

  assert.deepEqual(await savePlaceForUser(repository, "user-1", PLACE_ID), {
    ok: true,
    saved: true,
  });
  assert.equal(saved.has(`user-1:${PLACE_ID}`), true);
  assert.deepEqual(await unsavePlaceForUser(repository, "user-1", PLACE_ID), {
    ok: true,
    saved: false,
  });
  assert.equal(saved.has(`user-1:${PLACE_ID}`), false);
  assert.deepEqual(
    await savePlaceForUser(repository, "user-1", "00000000-0000-0000-0000-000000000000"),
    { ok: false, reason: "not-found" },
  );
});
