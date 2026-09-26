import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumePlacePhotoMutationLimits,
  consumePlacePhotoUploadLimits,
  PLACE_PHOTO_RATE_LIMITS,
  type OtpRateLimitStore,
} from "../src/lib/otp-rate-limit";
import {
  MAX_R2_UPLOAD_BYTES,
  type R2BucketLike,
  validatePlacePhotoFile,
} from "../src/lib/r2";
import {
  handlePlacePhotoDelete,
} from "../app/api/places/[id]/photos/[photoId]/route";
import {
  handlePlacePhotosGet,
  handlePlacePhotosPost,
} from "../app/api/places/[id]/photos/route";
import type {
  PlacePhoto,
  PlacePhotoCreateInput,
  PlacePhotoRepository,
} from "../src/lib/place-photos";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const PHOTO_ID = "7f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER_PHOTO_ID = "8f2504e0-4f89-11d3-9a0c-0305e82c3301";
const USER_ID = "contributor-123";
const OTHER_USER_ID = "contributor-456";
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

const AUTHENTICATED = async () => ({
  status: "authenticated" as const,
  userId: USER_ID,
});

class MemoryBucket implements R2BucketLike {
  objects = new Map<string, Uint8Array>();
  deleted: string[] = [];

  async put(key: string, value: ArrayBuffer) {
    this.objects.set(key, new Uint8Array(value.slice(0)));
  }

  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }

  async head(key: string) {
    return this.objects.has(key) ? {} : null;
  }

  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

type StoredPhoto = { ownerId: string; placeId: string; photo: PlacePhoto };

class MemoryPhotoRepository implements PlacePhotoRepository {
  placeExists = true;
  photos = new Map<string, StoredPhoto>();
  private nextId = 1;

  async hasPlace() {
    return this.placeExists;
  }

  async list(placeId: string, userId: string | null) {
    return Array.from(this.photos.values())
      .filter((entry) => entry.placeId === placeId)
      .sort((a, b) => b.photo.createdAt.localeCompare(a.photo.createdAt))
      .map((entry) => ({
        ...entry.photo,
        isOwn: entry.ownerId === userId,
      }));
  }

  async create(userId: string, placeId: string, input: PlacePhotoCreateInput) {
    const sequence = this.nextId++;
    const photo: PlacePhoto = {
      id: `${String(sequence).padStart(8, "0")}-4f89-11d3-9a0c-0305e82c3301`,
      r2Key: input.r2Key,
      contentType: input.contentType,
      byteSize: input.byteSize,
      fileName: input.fileName,
      createdAt: new Date(Date.UTC(2026, 8, sequence)).toISOString(),
      isOwn: true,
    };
    this.photos.set(photo.id, { ownerId: userId, placeId, photo });
    return photo;
  }

  async deleteOwn(userId: string, placeId: string, photoId: string) {
    const entry = this.photos.get(photoId);
    if (!entry || entry.ownerId !== userId || entry.placeId !== placeId) return null;
    this.photos.delete(photoId);
    return { r2Key: entry.photo.r2Key };
  }

  async getUploadAccess(key: string) {
    const entry = Array.from(this.photos.values()).find(
      (value) => value.photo.r2Key === key,
    );
    return entry
      ? { contentType: entry.photo.contentType, fileName: entry.photo.fileName }
      : null;
  }
}

function uploadRequest(file = new File([PNG_BYTES], "menu.png", { type: "image/png" })) {
  const form = new FormData();
  form.set("file", file);
  return new Request(`https://halalfood.world/api/places/${PLACE_ID}/photos`, {
    method: "POST",
    body: form,
    headers: { "cf-connecting-ip": "203.0.113.80" },
  });
}

function placeContext() {
  return { params: Promise.resolve({ id: PLACE_ID }) };
}

function deleteContext(photoId = PHOTO_ID) {
  return { params: Promise.resolve({ id: PLACE_ID, photoId }) };
}

test("place photo validation allows images but rejects PDF, type, size, and magic mismatches", () => {
  assert.equal(
    validatePlacePhotoFile({
      contentType: "application/pdf",
      sizeBytes: 12,
      fileName: "certificate.pdf",
      bytes: new TextEncoder().encode("%PDF-1.7\n"),
    }).ok,
    false,
  );
  assert.equal(
    validatePlacePhotoFile({
      contentType: "application/x-msdownload",
      sizeBytes: 12,
      fileName: "run.exe",
      bytes: PNG_BYTES,
    }).ok,
    false,
  );
  assert.deepEqual(
    validatePlacePhotoFile({
      contentType: "image/png",
      sizeBytes: MAX_R2_UPLOAD_BYTES + 1,
      fileName: "large.png",
      bytes: PNG_BYTES,
    }),
    { ok: false, status: 413, error: "Photos must be 8 MiB or smaller." },
  );
  assert.deepEqual(
    validatePlacePhotoFile({
      contentType: "image/jpeg",
      sizeBytes: 9,
      fileName: "not-a-photo.jpg",
      bytes: PNG_BYTES,
    }),
    {
      ok: false,
      status: 400,
      error: "The photo content does not match its declared file type.",
    },
  );
  assert.equal(
    validatePlacePhotoFile({
      contentType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      fileName: "menu.png",
      bytes: PNG_BYTES,
    }).ok,
    true,
  );
});

test("place photo upload and delete are auth-gated", async () => {
  const unauthenticated = async () => ({ status: "unauthenticated" as const });
  const upload = await handlePlacePhotosPost(
    uploadRequest(),
    placeContext(),
    { getAuth: unauthenticated },
  );
  assert.equal(upload.status, 401);
  assert.deepEqual(await upload.json(), {
    error: "Sign in to add a halal place photo.",
    loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${PLACE_ID}`)}`,
  });

  const deletion = await handlePlacePhotoDelete(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/photos/${PHOTO_ID}`, {
      method: "DELETE",
    }),
    deleteContext(),
    { getAuth: unauthenticated },
  );
  assert.equal(deletion.status, 401);
});

test("invalid photo input does not consume the upload limit", async () => {
  let consumed = false;
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7\n"], "evidence.pdf", { type: "application/pdf" }));
  const response = await handlePlacePhotosPost(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/photos`, {
      method: "POST",
      body: form,
    }),
    placeContext(),
    {
      getAuth: AUTHENTICATED,
      consumeUploadLimits: async () => {
        consumed = true;
        return { allowed: true, retryAfterMs: 0 };
      },
      getBucket: async () => {
        throw new Error("should not check R2 for invalid input");
      },
      repository: new MemoryPhotoRepository(),
    },
  );
  assert.equal(response.status, 400);
  assert.equal(consumed, false);
});

test("happy path uploads, lists, and deletes the authenticated user's photo", async () => {
  const repository = new MemoryPhotoRepository();
  const bucket = new MemoryBucket();
  let uploadLimitCalled = false;
  const upload = await handlePlacePhotosPost(uploadRequest(), placeContext(), {
    getAuth: AUTHENTICATED,
    repository,
    getBucket: async () => bucket,
    consumeUploadLimits: async (userId, ip) => {
      uploadLimitCalled = userId === USER_ID && ip === "203.0.113.80";
      return { allowed: true, retryAfterMs: 0 };
    },
  });
  assert.equal(upload.status, 201);
  assert.equal(uploadLimitCalled, true);
  const uploadBody = (await upload.json()) as {
    photo: { id: string; url: string; isOwn: boolean; contentType: string };
  };
  assert.equal(uploadBody.photo.isOwn, true);
  assert.equal(uploadBody.photo.contentType, "image/png");
  assert.match(uploadBody.photo.url, /^\/api\/uploads\/r2\?key=photos%2F/);
  assert.equal(repository.photos.size, 1);

  const listed = await handlePlacePhotosGet(new Request("https://halalfood.world"), placeContext(), {
    getAuth: AUTHENTICATED,
    repository,
  });
  assert.equal(listed.status, 200);
  const listedBody = (await listed.json()) as { photos: Array<{ id: string; isOwn: boolean }> };
  assert.equal(listedBody.photos.length, 1);
  assert.equal(listedBody.photos[0].id, uploadBody.photo.id);
  assert.equal(listedBody.photos[0].isOwn, true);

  const deleted = await handlePlacePhotoDelete(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/photos/${uploadBody.photo.id}`, {
      method: "DELETE",
      headers: { "cf-connecting-ip": "203.0.113.80" },
    }),
    deleteContext(uploadBody.photo.id),
    {
      getAuth: AUTHENTICATED,
      repository,
      getBucket: async () => bucket,
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
    },
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), {
    placeId: PLACE_ID,
    photoId: uploadBody.photo.id,
    deleted: true,
  });
  assert.equal(repository.photos.size, 0);
  assert.equal(bucket.deleted.length, 1);
  assert.equal(bucket.objects.size, 0);

  const afterDelete = await handlePlacePhotosGet(new Request("https://halalfood.world"), placeContext(), {
    getAuth: AUTHENTICATED,
    repository,
  });
  assert.deepEqual(await afterDelete.json(), { placeId: PLACE_ID, photos: [] });
});

test("place photo deletion rejects another user's photo and does not delete its R2 object", async () => {
  const repository = new MemoryPhotoRepository();
  const bucket = new MemoryBucket();
  const otherKey = "photos/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/8f2504e0-4f89-11d3-9a0c-0305e82c3301.png";
  repository.photos.set(OTHER_PHOTO_ID, {
    ownerId: OTHER_USER_ID,
    placeId: PLACE_ID,
    photo: {
      id: OTHER_PHOTO_ID,
      r2Key: otherKey,
      contentType: "image/png",
      byteSize: PNG_BYTES.byteLength,
      fileName: "other.png",
      createdAt: "2026-09-14T12:00:00.000Z",
      isOwn: false,
    },
  });
  bucket.objects.set(otherKey, PNG_BYTES);
  const response = await handlePlacePhotoDelete(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/photos/${OTHER_PHOTO_ID}`, {
      method: "DELETE",
    }),
    deleteContext(OTHER_PHOTO_ID),
    {
      getAuth: AUTHENTICATED,
      repository,
      getBucket: async () => bucket,
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
    },
  );
  assert.equal(response.status, 404);
  assert.equal(repository.photos.has(OTHER_PHOTO_ID), true);
  assert.deepEqual(bucket.deleted, []);
  assert.equal(bucket.objects.has(otherKey), true);
});

test("place photo limiter uses hashed user and IP buckets for uploads and mutations", async () => {
  let received: Parameters<OtpRateLimitStore["consume"]>[0] | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };

  await consumePlacePhotoUploadLimits(USER_ID, "203.0.113.80", store, new Date(0));
  assert.ok(received);
  assert.match(received[0].key, /^place-photo:upload:user:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^place-photo:upload:ip:[0-9a-f]{64}$/);
  assert.doesNotMatch(received[0].key, new RegExp(USER_ID));
  assert.equal(received[0].rule.maxCount, PLACE_PHOTO_RATE_LIMITS.uploadUser.maxCount);
  assert.equal(received[1].rule.maxCount, PLACE_PHOTO_RATE_LIMITS.uploadIp.maxCount);

  await consumePlacePhotoMutationLimits(USER_ID, "203.0.113.80", store, new Date(0));
  assert.ok(received);
  assert.match(received[0].key, /^place-photo:mutate:user:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^place-photo:mutate:ip:[0-9a-f]{64}$/);
  assert.equal(received[0].rule.maxCount, PLACE_PHOTO_RATE_LIMITS.mutationUser.maxCount);
  assert.equal(received[1].rule.maxCount, PLACE_PHOTO_RATE_LIMITS.mutationIp.maxCount);
});

test("rate-limited photo uploads do not write to R2", async () => {
  const bucket = new MemoryBucket();
  const response = await handlePlacePhotosPost(uploadRequest(), placeContext(), {
    getAuth: AUTHENTICATED,
    repository: new MemoryPhotoRepository(),
    getBucket: async () => bucket,
    consumeUploadLimits: async () => ({ allowed: false, retryAfterMs: 4000 }),
  });
  assert.equal(response.status, 429);
  assert.equal(bucket.objects.size, 0);
  assert.equal(response.headers.get("Retry-After"), "4");
});
