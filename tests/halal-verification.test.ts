import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeHalalVerificationLimits,
  consumeHalalVerificationUploadLimits,
  HALAL_VERIFICATION_RATE_LIMITS,
  type OtpRateLimitStore,
} from "../src/lib/otp-rate-limit";
import {
  EMPTY_HALAL_CHECK_ANSWERS,
  validateHalalEvidenceUrl,
  validateHalalVerificationSubmission,
} from "../src/lib/halal-verification";
import {
  mapCheckAnswers,
  submitHalalVerification,
  summarizeHalalChecks,
  type HalalVerificationRepository,
} from "../src/lib/halal-verifications";
import {
  handleVerificationGet,
  handleVerificationPost,
} from "../app/api/places/[id]/verifications/route";
import type { HalalStatusRepository } from "../src/lib/halal-status";
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

/** Defaults for the source-attribution columns added in migration 0008. */
const EVIDENCE_ATTRIBUTES = {
  kind: "first-hand" as const,
  claimedStatus: "self-declared" as const,
  scope: "venue" as const,
  scopeNote: null,
  certificationBody: null,
  certificateId: null,
  sourceUrl: null,
  capturedAt: "2026-09-01T12:00:00.000Z",
  expiresAt: "2027-03-01T12:00:00.000Z",
  relationship: "none" as const,
  incentivized: false,
  stale: false,
};

const SUBMISSION_ATTRIBUTES = {
  kind: "first-hand" as const,
  claimedStatus: "self-declared" as const,
  scope: "venue" as const,
  scopeNote: null,
  certificationBody: null,
  certificateId: null,
  capturedAt: Date.parse("2026-09-01T12:00:00.000Z"),
  expiresAt: Date.parse("2027-03-01T12:00:00.000Z"),
  sourceUrl: null,
  relationship: "none" as const,
  incentivized: false,
  visibility: "public" as const,
};

const APPROVED_VERIFICATION = {
  ...EVIDENCE_ATTRIBUTES,
  id: "verification-approved",
  status: "approved" as const,
  note: "Reviewed community evidence",
  createdAt: "2026-09-01T12:00:00.000Z",
  evidence: [{ kind: "link" as const, url: "https://youtu.be/example" }],
  answers: null,
};
const PENDING_VERIFICATION = {
  ...EVIDENCE_ATTRIBUTES,
  id: "verification-pending",
  status: "pending" as const,
  note: "Awaiting review",
  createdAt: "2026-09-02T12:00:00.000Z",
  evidence: [{ kind: "link" as const, url: "https://www.zabihah.com/biz/example" }],
  answers: { certificate: "seen" as const, alcohol: "none" as const, meat: null },
};

function readRepository(
  options: {
    hasPlace?: boolean;
    list?: HalalVerificationRepository["list"];
  } = {},
): HalalVerificationRepository {
  return {
    async hasPlace() {
      return options.hasPlace ?? true;
    },
    async list(placeId, userId) {
      return options.list ? options.list(placeId, userId) : [];
    },
    async create() {
      throw new Error("create is not available in a read-only test repository");
    },
    async getUploadAccess() {
      return null;
    },
  };
}

test("verification GET rejects a malformed place id without reading dependencies", async () => {
  const response = await handleVerificationGet(
    new Request("https://halalfood.world/api/places/not-a-place/verifications"),
    { params: Promise.resolve({ id: "not-a-place" }) },
    {
      getAuth: async () => {
        throw new Error("authentication should not run");
      },
      repository: readRepository(),
      statusRepository: {
        async get() {
          throw new Error("status should not run");
        },
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Invalid place id." });
});

test("verification GET returns not found for a missing published place", async () => {
  const response = await handleVerificationGet(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/verifications`),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: async () => ({ status: "unauthenticated" }),
      repository: readRepository({ hasPlace: false }),
      statusRepository: {
        async get() {
          throw new Error("status should not run for a missing place");
        },
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "That halal place could not be found.",
  });
});

test("verification GET returns public evidence and an independently aggregated summary", async () => {
  const statusRepository: HalalStatusRepository = {
    async get() {
      return {
        approvedCount: "2",
        latestReviewedAt: "2026-09-10 14:30:00Z",
      };
    },
  };
  const repository = readRepository({
    async list(_placeId, userId) {
      return userId
        ? [APPROVED_VERIFICATION, PENDING_VERIFICATION]
        : [APPROVED_VERIFICATION];
    },
  });

  const response = await handleVerificationGet(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/verifications`),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: async () => ({ status: "unauthenticated" }),
      repository,
      statusRepository,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
  assert.deepEqual(await response.json(), {
    verifications: [APPROVED_VERIFICATION],
    summary: {
      status: "evidence-backed",
      approvedCount: 2,
      latestReviewedAt: "2026-09-10T14:30:00.000Z",
    },
  });
});

test("verification GET includes the signed-in user's pending evidence without counting it", async () => {
  const response = await handleVerificationGet(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/verifications`),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: AUTHENTICATED,
      repository: readRepository({
        async list(_placeId, userId) {
          return userId === USER_ID
            ? [PENDING_VERIFICATION, APPROVED_VERIFICATION]
            : [APPROVED_VERIFICATION];
        },
      }),
      statusRepository: {
        async get() {
          return {
            approvedCount: 1,
            latestReviewedAt: 1_704_067_200_000,
          };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    verifications: [PENDING_VERIFICATION, APPROVED_VERIFICATION],
    summary: {
      status: "evidence-backed",
      approvedCount: 1,
      latestReviewedAt: "2024-01-01T00:00:00.000Z",
    },
  });
});

test("verification GET returns the existing unavailable response when status lookup fails", async () => {
  const response = await handleVerificationGet(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/verifications`),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: async () => ({ status: "unauthenticated" }),
      repository: readRepository(),
      statusRepository: {
        async get() {
          throw new Error("status storage unavailable");
        },
      },
    },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Halal verification is temporarily unavailable. Please try again.",
  });
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
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.note, "Confirmed with the supplier.");
  assert.deepEqual(result.data.evidence, [
    { kind: "link", url: "https://www.zabihah.com/biz/example" },
  ]);
  // Source attribution defaults are conservative: an undeclared submission is
  // a dated, expiring, self-declared claim from an uninterested party.
  assert.equal(result.data.attributes.kind, "first-hand");
  assert.equal(result.data.attributes.claimedStatus, "self-declared");
  assert.equal(result.data.attributes.scope, "venue");
  assert.equal(result.data.attributes.relationship, "none");
  assert.equal(result.data.attributes.incentivized, false);
  assert.ok(result.data.attributes.expiresAt > result.data.attributes.capturedAt);
  assert.deepEqual(result.data.answers, EMPTY_HALAL_CHECK_ANSWERS);
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

test("verification service handles the happy path without a database", async () => {
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
    answers: EMPTY_HALAL_CHECK_ANSWERS,
    attributes: SUBMISSION_ATTRIBUTES,
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

test("verification validation accepts a structured check without evidence", () => {
  const result = validateHalalVerificationSubmission({
    answers: { certificate: "seen", alcohol: "none", meat: "unsure" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.answers, {
    certificate: "seen",
    alcohol: "none",
    meat: "unsure",
  });
  assert.deepEqual(result.data.evidence, []);
});

test("verification validation rejects a check with only unsure answers and no evidence", () => {
  const result = validateHalalVerificationSubmission({
    answers: { certificate: "unsure", alcohol: "unsure" },
  });
  assert.equal(result.ok, false);
});

test("verification validation rejects unknown answers and questions", () => {
  assert.equal(
    validateHalalVerificationSubmission({ answers: { certificate: "definitely" } }).ok,
    false,
  );
  assert.equal(
    validateHalalVerificationSubmission({ answers: { pork: "none" } }).ok,
    false,
  );
  assert.equal(validateHalalVerificationSubmission({ answers: "seen" }).ok, false);
});

test("check answers map only when the joined row exists", () => {
  assert.equal(mapCheckAnswers({ answers_id: null, certificate: "seen" }), null);
  assert.deepEqual(
    mapCheckAnswers({ answers_id: "v1", certificate: "seen", alcohol: "bogus", meat: "hand" }),
    { certificate: "seen", alcohol: null, meat: "hand" },
  );
});

test("glance keeps the latest definite answer per question", () => {
  const glance = summarizeHalalChecks([
    { certificate: "seen", alcohol: "none", meat: null, reviewedAt: 1_700_000_000_000 },
    { certificate: "unsure", alcohol: "served", meat: "hand", reviewedAt: 1_800_000_000_000 },
    { certificate: "not-seen", alcohol: null, meat: null, reviewedAt: "not a date" },
  ]);
  assert.deepEqual(glance, {
    certificate: { value: "seen", reviewedAt: new Date(1_700_000_000_000).toISOString() },
    alcohol: { value: "served", reviewedAt: new Date(1_800_000_000_000).toISOString() },
    meat: { value: "hand", reviewedAt: new Date(1_800_000_000_000).toISOString() },
  });
});
