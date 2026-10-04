import assert from "node:assert/strict";
import test from "node:test";
import { deriveHalalAssessment } from "@halalfood/core/halal-taxonomy";
import { handleAdminReview } from "../app/api/admin/review/[kind]/[id]/route";
import { handleConfirmationPost } from "../app/api/confirmations/route";
import { handleVerificationPost } from "../app/api/places/[id]/verifications/route";
import { listContributions } from "../src/lib/contributions-repository";
import { confirmCommunityTarget } from "../src/lib/community-confirmations";
import {
  d1HalalVerificationRepository,
  listApprovedEvidenceRecords,
} from "../src/lib/halal-verifications";
import { createReport, listReports } from "../src/lib/moderation-repository";
import { getModeratorRole } from "../src/lib/preferences-repository";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const SUBMISSION_ID = "35637dae-1111-4111-8111-111111111111";
const VERIFICATION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VISIT_ID = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function auth(userId: string) {
  return async () => ({ status: "authenticated" as const, userId });
}

function review(
  db: ReturnType<typeof createTestDatabase>["db"],
  userId: string,
  body: unknown,
  id = SUBMISSION_ID,
) {
  return handleAdminReview(
    new Request(`https://halalfood.world/api/admin/review/place/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ kind: "place", id }) },
    {
      getAuth: auth(userId),
      getRole: (candidate) => getModeratorRole(candidate, db),
      database: db,
    },
  );
}

function insertPlace(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
  id: string,
  listingStatus = "listed",
  googlePlaceId: string | null = null,
) {
  sqlite
    .prepare(
      `INSERT INTO places (
        id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
        scraped_at, created_at, halal_confirmed, listing_status, google_place_id
      ) VALUES (?, 'Samad Cafe', 'london', '/city/london', '1 High Street', '[]', 'user-submitted',
        'https://example.com/samad', 1, 1, 1, ?, ?)`,
    )
    .run(id, listingStatus, googlePlaceId);
}

function insertSubmission(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
  options: { googlePlaceId?: string | null; name?: string } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO place_link_submissions (
        id, submitted_by_user_id, name, city_slug, street_address, source_url,
        google_place_id, status, status_reason, created_at, updated_at
      ) VALUES (?, 'submitter', ?, 'london', '1 High Street', 'https://maps.example/samad',
        ?, 'pending', 'Waiting for a person to review this place.', 10, 10)`,
    )
    .run(
      SUBMISSION_ID,
      options.name ?? "Test Cafe",
      options.googlePlaceId ?? null,
    );
}

test("place review is refused until the account is a moderator", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "submitter");
  addUser(sqlite, "diner");
  addUser(sqlite, "moderator");
  sqlite
    .prepare(`INSERT INTO moderators (user_id, role, created_at) VALUES ('moderator', 'moderator', 1)`)
    .run();
  insertSubmission(sqlite);

  const signedOut = await handleAdminReview(
    new Request("https://halalfood.world/api/admin/review/place/" + SUBMISSION_ID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    }),
    { params: Promise.resolve({ kind: "place", id: SUBMISSION_ID }) },
    {
      getAuth: async () => ({ status: "unauthenticated" }),
      getRole: async () => {
        throw new Error("role lookup should not run");
      },
      database: db,
    },
  );
  assert.equal(signedOut.status, 401);

  const stranger = await review(db, "diner", { decision: "approved" });
  assert.equal(stranger.status, 403);
  const still = sqlite
    .prepare(`SELECT status FROM place_link_submissions WHERE id = ?`)
    .get(SUBMISSION_ID) as { status: string };
  assert.equal(still.status, "pending");
});

test("rejecting a place requires a reason the submitter can read", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "submitter");
  addUser(sqlite, "moderator");
  sqlite
    .prepare(`INSERT INTO moderators (user_id, role, created_at) VALUES ('moderator', 'admin', 1)`)
    .run();
  insertSubmission(sqlite);

  const missing = await review(db, "moderator", { decision: "rejected", reason: "  " });
  assert.equal(missing.status, 400);

  const response = await review(db, "moderator", {
    decision: "rejected",
    reason: "The link does not show a restaurant.",
  });
  assert.equal(response.status, 200);
  const history = await listContributions("submitter", db);
  const link = history.find((row) => row.id === SUBMISSION_ID);
  assert.equal(link?.status, "rejected");
  assert.equal(link?.statusReason, "The link does not show a restaurant.");
  const audit = sqlite
    .prepare(`SELECT actor_user_id, action, created_at FROM audit_log WHERE target_id = ?`)
    .get(SUBMISSION_ID) as { actor_user_id: string; action: string; created_at: number };
  assert.equal(audit.actor_user_id, "moderator");
  assert.equal(audit.action, "place.rejected");
  assert.ok(audit.created_at > 0);
});

test("approving a pending place lists it and records the moderator", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "submitter");
  addUser(sqlite, "moderator");
  sqlite
    .prepare(`INSERT INTO moderators (user_id, role, created_at) VALUES ('moderator', 'moderator', 1)`)
    .run();
  insertSubmission(sqlite, { googlePlaceId: "ChIJsamad" });
  sqlite
    .prepare(
      `INSERT INTO places (
        id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
        scraped_at, created_at, halal_confirmed, listing_status, google_place_id
      ) VALUES (?, 'Hidden Cafe', 'london', '/city/london', '9 Other Road', '[]', 'import',
        'https://example.com/hidden', 1, 1, 0, 'hidden', 'ChIJsamad')`,
    )
    .run(PLACE_ID);

  const response = await review(db, "moderator", { decision: "approved" });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { placeId: string };
  assert.equal(body.placeId, PLACE_ID);
  const place = sqlite
    .prepare(`SELECT listing_status, halal_confirmed FROM places WHERE id = ?`)
    .get(PLACE_ID) as { listing_status: string; halal_confirmed: number };
  assert.equal(place.listing_status, "listed");
  assert.equal(place.halal_confirmed, 1);
  const submission = sqlite
    .prepare(`SELECT status, matched_place_id FROM place_link_submissions WHERE id = ?`)
    .get(SUBMISSION_ID) as { status: string; matched_place_id: string };
  assert.equal(submission.status, "accepted");
  assert.equal(submission.matched_place_id, PLACE_ID);
  const audit = sqlite
    .prepare(`SELECT actor_user_id, action FROM audit_log WHERE target_id = ?`)
    .get(SUBMISSION_ID) as { actor_user_id: string; action: string };
  assert.equal(audit.action, "place.listed");
  assert.equal(audit.actor_user_id, "moderator");
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM places`).get() as { n: number }).n,
    1,
  );
});

test("approving a new place inserts a listed row", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "submitter");
  addUser(sqlite, "moderator");
  sqlite
    .prepare(`INSERT INTO moderators (user_id, role, created_at) VALUES ('moderator', 'moderator', 1)`)
    .run();
  insertSubmission(sqlite);

  const response = await review(db, "moderator", { decision: "approved" });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { placeId: string };
  const place = sqlite
    .prepare(`SELECT name, listing_status, halal_confirmed, city_slug FROM places WHERE id = ?`)
    .get(body.placeId) as {
    name: string;
    listing_status: string;
    halal_confirmed: number;
    city_slug: string;
  };
  assert.equal(place.name, "Test Cafe");
  assert.equal(place.listing_status, "listed");
  assert.equal(place.halal_confirmed, 1);
  assert.equal(place.city_slug, "london");
});

test("a labelled halal check returns a reference and stores the answers", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "contributor-123");
  insertPlace(sqlite, PLACE_ID);

  const response = await handleVerificationPost(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/verifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: "Certificate by the till",
        evidence: [],
        answers: { certificate: "seen", alcohol: "none", meat: "hand" },
      }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: auth("contributor-123"),
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      repository: d1HalalVerificationRepository(db),
    },
  );
  assert.equal(response.status, 201);
  const body = (await response.json()) as { id: string; placeId: string; status: string };
  assert.equal(body.placeId, PLACE_ID);
  assert.equal(body.status, "pending");
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  const answers = sqlite
    .prepare(
      `SELECT certificate, alcohol, meat FROM place_halal_check_answers WHERE verification_id = ?`,
    )
    .get(body.id) as { certificate: string; alcohol: string; meat: string };
  assert.equal(answers.certificate, "seen");
  assert.equal(answers.alcohol, "none");
  assert.equal(answers.meat, "hand");
});

test("a failed halal check names the failure and hides the SQL", async () => {
  const response = await handleVerificationPost(
    new Request(`https://halalfood.world/api/places/${PLACE_ID}/verifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidence: [],
        answers: { certificate: "seen", alcohol: "none", meat: "hand" },
      }),
    }),
    { params: Promise.resolve({ id: PLACE_ID }) },
    {
      getAuth: auth("contributor-123"),
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      repository: {
        async hasPlace() {
          return true;
        },
        async list() {
          return [];
        },
        async create() {
          throw new Error("FOREIGN KEY constraint failed: place_halal_check_answers");
        },
        async getUploadAccess() {
          return null;
        },
      },
    },
  );
  assert.equal(response.status, 503);
  const body = (await response.json()) as { error: string; reference: string; code: string };
  assert.match(body.error, /Sending this halal check/);
  assert.match(body.reference, /^[0-9a-f-]{8}$/);
  assert.equal(body.code, "unavailable");
  assert.doesNotMatch(JSON.stringify(body), /FOREIGN KEY|place_halal_check_answers/);
});

test("confirmations are unique, refuse the author, and feed the status", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "author");
  addUser(sqlite, "viewer");
  addUser(sqlite, "second");
  insertPlace(sqlite, PLACE_ID);
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO place_halal_verifications (
        id, place_id, submitted_by_user_id, status, created_at, updated_at,
        evidence_kind, claimed_status, visibility, relationship, incentivized, captured_at
      ) VALUES (?, ?, 'author', 'approved', ?, ?, 'first-hand', 'community-verified', 'public', 'none', 0, ?)`,
    )
    .run(VERIFICATION_ID, PLACE_ID, now, now, now);

  const before = deriveHalalAssessment(await listApprovedEvidenceRecords(PLACE_ID, db), now);
  assert.equal(before.status, "self-declared");

  const own = await handleConfirmationPost(
    new Request("https://halalfood.world/api/confirmations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType: "verification", targetId: VERIFICATION_ID }),
    }),
    {
      getAuth: auth("author"),
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      database: db,
    },
  );
  assert.equal(own.status, 403);

  const first = await handleConfirmationPost(
    new Request("https://halalfood.world/api/confirmations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType: "verification", targetId: VERIFICATION_ID }),
    }),
    {
      getAuth: auth("viewer"),
      consumeLimits: async () => ({ allowed: true, retryAfterMs: 0 }),
      database: db,
    },
  );
  assert.equal(first.status, 201);
  const again = await confirmCommunityTarget("viewer", "verification", VERIFICATION_ID, db);
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.equal(again.created, false);
    assert.equal(again.confirmCount, 1);
  }
  const rows = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM community_confirmations`)
    .get() as { n: number };
  assert.equal(rows.n, 1);

  const after = deriveHalalAssessment(await listApprovedEvidenceRecords(PLACE_ID, db), now);
  assert.equal(after.status, "community-verified");
  assert.equal(after.contributorCount, 2);

  const listed = await d1HalalVerificationRepository(db).list(PLACE_ID, "second");
  assert.equal(listed[0]?.confirmCount, 1);
  assert.equal(listed[0]?.viewerConfirmed, false);

  await createReport(
    {
      targetType: "verification",
      targetId: VERIFICATION_ID,
      reason: "factual-error",
      detail: "This check describes a different branch.",
    },
    "second",
    db,
  );
  const open = await listReports({ status: "open" }, db);
  assert.equal(
    open.some((report) => report.targetId === VERIFICATION_ID && report.targetType === "verification"),
    true,
  );
  const withReport = await d1HalalVerificationRepository(db).list(PLACE_ID, "viewer");
  assert.equal(withReport[0]?.reportCount, 1);
  assert.equal(withReport[0]?.viewerConfirmed, true);

  sqlite
    .prepare(
      `INSERT INTO place_visits (id, user_id, place_id, visited_at, visibility, created_at, updated_at)
       VALUES (?, 'author', ?, ?, 'public', ?, ?)`,
    )
    .run(VISIT_ID, PLACE_ID, now, now, now);
  sqlite
    .prepare(
      `INSERT INTO place_check_ins (
        visit_id, place_id, user_id, would_return, value_verdict, halal_verification_id, created_at, updated_at
      ) VALUES (?, ?, 'author', 'definitely', 'fair', ?, ?, ?)`,
    )
    .run(VISIT_ID, PLACE_ID, VERIFICATION_ID, now, now);

  const ownVisit = await confirmCommunityTarget("author", "check-in", VISIT_ID, db);
  assert.deepEqual(ownVisit, { ok: false, reason: "own" });
  const visitConfirm = await confirmCommunityTarget("second", "check-in", VISIT_ID, db);
  assert.equal(visitConfirm.ok && visitConfirm.created, true);
  const repeatVisit = await confirmCommunityTarget("second", "check-in", VISIT_ID, db);
  assert.equal(repeatVisit.ok && repeatVisit.created, false);
  assert.equal(
    (sqlite.prepare(
      `SELECT COUNT(*) AS n FROM community_confirmations WHERE target_type = 'check-in'`,
    ).get() as { n: number }).n,
    1,
  );
});
