import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeHalalVerificationLimits,
  consumeHalalVerificationUploadLimits,
  HALAL_VERIFICATION_RATE_LIMITS,
  type OtpRateLimitStore,
} from "../src/lib/otp-rate-limit";
import {
  validateHalalEvidenceUrl,
  validateHalalVerificationSubmission,
} from "../src/lib/halal-verification";
import {
  submitHalalVerification,
  type HalalVerificationRepository,
} from "../src/lib/halal-verifications";
import {
  handleVerificationPost,
} from "../app/api/places/[id]/verifications/route";
import { handleR2Upload } from "../app/api/uploads/r2/route";
import {
  evidenceOwnerPrefix,
  hasExpectedFileSignature,
  MAX_R2_UPLOAD_BYTES,
  type R2BucketLike,
  validateR2UploadMetadata,
} from "../src/lib/r2";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const USER_ID = "contributor-123";
const AUTHENTICATED = async () => ({
  status: "authenticated" as const,
  userId: USER_ID,
});

test("halal evidence URLs allow the supported platforms and reject other hosts", () => {
  assert.equal(
    validateHalalEvidenceUrl("https://www.zabihah.com/biz/example"),
    "https://www.zabihah.com/biz/example",
  );
  assert.equal(
    validateHalalEvidenceUrl("https://www.instagram.com/p/example/"),
    "https://www.instagram.com/p/example/",
  );
  assert.equal(validateHalalEvidenceUrl("https://www.tiktok.com/@place/video/1"), "https://www.tiktok.com/@place/video/1");
  assert.equal(validateHalalEvidenceUrl("https://youtu.be/example"), "https://youtu.be/example");
  for (const value of [
    "http://www.zabihah.com/biz/example",
    "https://example.com/halal",
    "https://www.youtube.com/",
    "https://www.zabihah.com/",
    "https://www.zabihah.com.evil.example/biz/example",
  ])
    assert.equal(validateHalalEvidenceUrl(value), null, value);
});

test("verification validation requires evidence and accepts a normalized link", () => {
  assert.equal(
    validateHalalVerificationSubmission({ note: "context", evidence: [] }).ok,
    false,
  );
  const result = validateHalalVerificationSubmission({
    note: "  Confirmed with the supplier.  ",
    evidence: [{ kind: "link", url: " https://www.zabihah.com/biz/example " }],
  });
  assert.deepEqual(result, {
    ok: true,
    data: {
      note: "Confirmed with the supplier.",
      evidence: [{ kind: "link", url: "https://www.zabihah.com/biz/example" }],
    },
  });
});

test("verification validation rejects malformed upload metadata", async () => {
  const prefix = await evidenceOwnerPrefix(USER_ID);
  const result = validateHalalVerificationSubmission({
    evidence: [
      {
        kind: "upload",
        key: `${prefix}00000000-0000-0000-0000-000000000000.pdf`,
        contentType: "application/x-msdownload",
        sizeBytes: 12,
        fileName: "evidence.pdf",
      },
    ],
  });
  assert.equal(result.ok, false);
});

test("halal verification limiter passes hashed user and IP buckets", async () => {
  let received: Parameters<OtpRateLimitStore["consume"]>[0] | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };

  await consumeHalalVerificationLimits(USER_ID, "203.0.113.50", store, new Date(0));
  assert.ok(received);
  assert.match(received[0].key, /^halal-verification:submit:user:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^halal-verification:submit:ip:[0-9a-f]{64}$/);
  assert.doesNotMatch(received[0].key, new RegExp(USER_ID));
  assert.equal(received[0].rule.maxCount, HALAL_VERIFICATION_RATE_LIMITS.submissionUser.maxCount);
  assert.equal(received[1].rule.maxCount, HALAL_VERIFICATION_RATE_LIMITS.submissionIp.maxCount);
});

test("R2 upload limiter also uses separate hashed user and IP buckets", async () => {
  let received: Parameters<OtpRateLimitStore["consume"]>[0] | undefined;
  const store: OtpRateLimitStore = {
    async consume(buckets) {
      received = buckets;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
  await consumeHalalVerificationUploadLimits(USER_ID, "203.0.113.51", store, new Date(0));
  assert.ok(received);
  assert.match(received[0].key, /^halal-verification:upload:user:[0-9a-f]{64}$/);
  assert.match(received[1].key, /^halal-verification:upload:ip:[0-9a-f]{64}$/);
  assert.equal(received[0].rule.maxCount, HALAL_VERIFICATION_RATE_LIMITS.uploadUser.maxCount);
  assert.equal(received[1].rule.maxCount, HALAL_VERIFICATION_RATE_LIMITS.uploadIp.maxCount);
});

test("verification API returns a sign-in CTA before parsing an unauthenticated submission", async () => {
  const response = await handleVerificationPost(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/verifications`, {
      method: "POST",
      body: "not json",
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    { getAuth: async () => ({ status: "unauthenticated" }) },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Sign in to submit halal verification evidence.",
    loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${PLACE_ID}`)}`,
  });
});

test("verification API writes a pending submission through the repository boundary", async () => {
  let created: { userId: string; placeId: string } | undefined;
  const repository: HalalVerificationRepository = {
    async hasPlace(placeId) {
      return placeId === PLACE_ID;
    },
    async list() {
      return [];
    },
    async create(userId, placeId) {
      created = { userId, placeId };
      return { id: "verification-1", status: "pending" };
    },
    async getUploadAccess() {
      return null;
    },
  };
  const response = await handleVerificationPost(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/verifications`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" },
      body: JSON.stringify({
        note: "Supplier confirmation",
        evidence: [{ kind: "link", url: "https://www.zabihah.com/biz/example" }],
      }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      repository,
    },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    id: "verification-1",
    placeId: PLACE_ID,
    status: "pending",
  });
  assert.deepEqual(created, { userId: USER_ID, placeId: PLACE_ID });
});

test("verification service handles the happy path without Neon", async () => {
  const repository: HalalVerificationRepository = {
    async hasPlace(placeId) {
      return placeId === PLACE_ID;
    },
    async list() {
      return [];
    },
    async create() {
      return { id: "verification-2", status: "pending" };
    },
    async getUploadAccess() {
      return null;
    },
  };
  const result = await submitHalalVerification(repository, USER_ID, PLACE_ID, {
    note: null,
    evidence: [{ kind: "link", url: "https://youtu.be/example" }],
  });
  assert.deepEqual(result, {
    ok: true,
    verification: { id: "verification-2", status: "pending" },
  });
});

test("R2 upload guards enforce the content-type and 8 MiB limits", () => {
  assert.equal(
    validateR2UploadMetadata({
      contentType: "application/x-msdownload",
      sizeBytes: 12,
      fileName: "run.exe",
    }).ok,
    false,
  );
  const tooLarge = validateR2UploadMetadata({
    contentType: "application/pdf",
    sizeBytes: MAX_R2_UPLOAD_BYTES + 1,
    fileName: "certificate.pdf",
  });
  assert.deepEqual(tooLarge, {
    ok: false,
    status: 413,
    error: "Uploads must be 8 MiB or smaller.",
  });
  assert.equal(
    hasExpectedFileSignature("application/pdf", new TextEncoder().encode("%PDF-1.7")),
    true,
  );
  assert.equal(
    hasExpectedFileSignature("application/pdf", new TextEncoder().encode("not a pdf")),
    false,
  );
});

test("R2 upload API fails closed without a binding and rejects oversized requests", async () => {
  const auth = { getAuth: AUTHENTICATED, getBucket: async () => null };
  const missing = await handleR2Upload(
    new Request("https://halalfood.world/api/uploads/r2", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=unused" },
    }),
    auth,
  );
  assert.equal(missing.status, 503);

  const oversized = await handleR2Upload(
    new Request("https://halalfood.world/api/uploads/r2", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=unused",
        "content-length": String(MAX_R2_UPLOAD_BYTES + 256 * 1024 + 1),
      },
    }),
    { getAuth: AUTHENTICATED, getBucket: async () => ({} as R2BucketLike) },
  );
  assert.equal(oversized.status, 413);
});

test("R2 upload API stores a valid PDF with the authenticated account scope", async () => {
  let storedKey = "";
  const bucket: R2BucketLike = {
    async put(key) {
      storedKey = key;
    },
    async get() {
      return null;
    },
    async head() {
      return {};
    },
  };
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7\ncertificate"], "supplier.pdf", { type: "application/pdf" }));
  const response = await handleR2Upload(
    new Request("https://halalfood.world/api/uploads/r2", { method: "POST", body: form }),
    {
      getAuth: AUTHENTICATED,
      getBucket: async () => bucket,
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
    },
  );
  assert.equal(response.status, 201);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.contentType, "application/pdf");
  assert.equal(body.fileName, "supplier.pdf");
  assert.match(String(body.key), /^community-verification\/[a-f0-9]{64}\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(storedKey, body.key);
});
