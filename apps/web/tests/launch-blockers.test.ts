import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheckIn } from "@halalfood/core/check-in";
import { filtersFromStandards } from "@halalfood/core/discovery-filters";
import { deriveHalalAssessment } from "@halalfood/core/halal-taxonomy";
import { emptyFacts } from "@halalfood/core/place-facts";
import { PUBLIC_MEMBER_LABEL } from "@halalfood/core/public-identity";
import { validateRec } from "@halalfood/core/recs";
import { validateOnboarding } from "@halalfood/core/social";
import {
  DEFAULT_PREFERENCES,
  evaluateSuitability,
  validatePreferences,
} from "@halalfood/core/user-preferences";
import { listContributions } from "../src/lib/contributions-repository";
import { listFriendsFeed } from "../src/lib/feed-repository";
import { listNotifications } from "../src/lib/notifications-repository";
import {
  d1PlaceReviewRepository,
} from "../src/lib/place-reviews";
import {
  getOrCreateProfile,
  getPreferences,
  savePreferences,
} from "../src/lib/preferences-repository";
import { replyToRec, sendRecs } from "../src/lib/recs-repository";
import { completeOnboarding, followUser } from "../src/lib/social-repository";
import {
  listPassportVisits,
  listPublicCheckIns,
  recordVisit,
} from "../src/lib/visits";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const PLACE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const EMAIL = "z4blt7@mail.instinct.com";
const KEY = "11111111-1111-4111-8111-111111111111";

function insertPlace(sqlite: ReturnType<typeof createTestDatabase>["sqlite"]) {
  sqlite
    .prepare(
      `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed)
       VALUES (?, 'Muslim Hotel', 'delhi', 'u', 'a', '[]', 's', 'u', 1, 1, 1)`,
    )
    .run(PLACE);
}

function checkIn(visibility: "public" | "private", shareToFeed?: boolean) {
  const validated = validateCheckIn({
    verdict: "liked",
    valueVerdict: "fair",
    visibility,
    relationship: "none",
    ...(shareToFeed === undefined ? {} : { shareToFeed }),
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error("check-in");
  return validated.data;
}

const proof = { method: "none" as const, confidence: "none" as const, detail: "No proof attached." };

test("a review never publishes an email, even when the account name is the address", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "reviewer", EMAIL);
  sqlite
    .prepare(`UPDATE "user" SET email = ? WHERE id = 'reviewer'`)
    .run(EMAIL);
  insertPlace(sqlite);
  const reviews = d1PlaceReviewRepository(db);
  assert.equal(await reviews.publicIdentity!("reviewer"), PUBLIC_MEMBER_LABEL);
  assert.equal(
    await reviews.upsert("reviewer", PLACE, {
      title: null,
      body: "QA note that must not carry an email.",
    }),
    true,
  );
  const listed = await reviews.list(PLACE, null);
  const serialized = JSON.stringify(listed);
  assert.equal(listed[0]?.authorDisplayName, PUBLIC_MEMBER_LABEL);
  assert.equal(serialized.includes(EMAIL), false);
  assert.equal(serialized.includes("@"), false);

  await completeOnboarding(
    "reviewer",
    (() => {
      const parsed = validateOnboarding({
        displayName: "Amina Khan",
        handle: "amina_eats",
      });
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.data;
    })(),
    db,
  );
  assert.equal(await reviews.publicIdentity!("reviewer"), "Amina Khan");
  assert.equal((await reviews.list(PLACE, null))[0]?.authorDisplayName, "Amina Khan");
});

test("contribution history orders a compound select the way D1 requires", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "reviewer");
  insertPlace(sqlite);
  sqlite
    .prepare(
      `INSERT INTO place_dishes (id, place_id, name, normalized_name, submitted_by_user_id, status, created_at, updated_at)
       VALUES ('2c75d665-aac7-4ba1-bb8e-e0ab68319d3f', ?, 'QA dish', 'qa dish', 'reviewer', 'pending', 10, 10)`,
    )
    .run(PLACE);
  const rows = await listContributions("reviewer", db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, "dish");
  assert.equal(rows[0]?.status, "pending");
  assert.equal(rows[0]?.id, "2c75d665-aac7-4ba1-bb8e-e0ab68319d3f");
});

test("saved standards drive suitability and the map filter, and a failed save leaves them unchanged", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "diner");
  const parsed = validatePreferences({
    minimumStatus: "verified",
    requireCertification: true,
    avoidAlcohol: true,
    allergies: ["Peanuts"],
    visibilityVisits: "private",
    visibilityLists: "private",
    preferHandSlaughter: true,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await savePreferences("diner", parsed.data, db);
  const stored = await getPreferences("diner", db);
  assert.equal(stored.minimumStatus, "verified");
  assert.equal(stored.requireCertification, true);
  assert.equal(stored.avoidAlcohol, true);
  assert.deepEqual(stored.allergies, ["peanuts"]);
  assert.equal(stored.visibilityVisits, "private");
  assert.equal(stored.preferHandSlaughter, true);

  const filters = filtersFromStandards(stored);
  assert.ok(filters.facts.includes("noAlcohol"));
  assert.ok(filters.facts.includes("certified"));
  assert.deepEqual(filters.statuses, ["verified"]);

  const suitability = evaluateSuitability(
    stored,
    deriveHalalAssessment([], Date.now()),
    emptyFacts(PLACE),
  );
  assert.equal(suitability.meets, false);
  assert.ok(suitability.blockers.some((note) => note.code === "below-minimum-status"));

  sqlite.exec(`DROP TABLE user_preferences`);
  await assert.rejects(() => savePreferences("diner", stored, db));
});

test("a private visit stays in the passport and off the public profile and feed", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "ayesha");
  addUser(sqlite, "zaid");
  insertPlace(sqlite);
  const ayesha = validateOnboarding({ displayName: "Ayesha", handle: "ayesha_eats" });
  const zaid = validateOnboarding({ displayName: "Zaid", handle: "zaid_bites" });
  if (!ayesha.ok || !zaid.ok) throw new Error("onboarding");
  assert.equal((await completeOnboarding("ayesha", ayesha.data, db)).ok, true);
  assert.equal((await completeOnboarding("zaid", zaid.data, db)).ok, true);
  await savePreferences("zaid", { ...DEFAULT_PREFERENCES, minimumStatus: "unverified" }, db);
  assert.deepEqual(await followUser("zaid", "ayesha_eats", db), { ok: true, status: "accepted" });

  const first = await recordVisit(
    {
      userId: "ayesha",
      placeId: PLACE,
      visitedAt: Date.now(),
      verification: proof,
      receiptR2Key: null,
      checkIn: checkIn("private"),
      idempotencyKey: KEY,
    },
    db,
  );
  const again = await recordVisit(
    {
      userId: "ayesha",
      placeId: PLACE,
      visitedAt: Date.now(),
      verification: proof,
      receiptR2Key: null,
      checkIn: checkIn("private"),
      idempotencyKey: KEY,
    },
    db,
  );
  assert.equal(again.deduped, true);
  assert.equal(again.visitId, first.visitId);
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM place_visits`).get() as { n: number }).n,
    1,
  );
  assert.equal((await listPublicCheckIns(PLACE, 20, db)).length, 0);
  const hidden = await listFriendsFeed(
    { viewerId: "zaid", preferences: { ...DEFAULT_PREFERENCES, minimumStatus: "unverified" } },
    db,
  );
  assert.equal(hidden.cards.length, 0);
  assert.deepEqual(
    (await listPassportVisits("ayesha", db)).map((visit) => visit.placeId),
    [PLACE],
  );

  const shared = await recordVisit(
    {
      userId: "ayesha",
      placeId: PLACE,
      visitedAt: Date.now(),
      verification: proof,
      receiptR2Key: null,
      checkIn: checkIn("public", true),
    },
    db,
  );
  assert.equal(shared.deduped, false);
  assert.equal((await listPublicCheckIns(PLACE, 20, db)).length, 1);
  const feed = await listFriendsFeed(
    { viewerId: "zaid", preferences: { ...DEFAULT_PREFERENCES, minimumStatus: "unverified" } },
    db,
  );
  assert.deepEqual(
    feed.cards.map((card) => card.visitId),
    [shared.visitId],
  );
  const stranger = await listFriendsFeed(
    { viewerId: "stranger", preferences: DEFAULT_PREFERENCES },
    db,
  );
  assert.equal(stranger.cards.length, 0);
});

test("finishing onboarding rolls the handle back when a later step fails", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "newbie");
  const before = await getOrCreateProfile("newbie", db);
  sqlite.exec(`DROP TABLE user_preferences`);
  const parsed = validateOnboarding({
    displayName: "Ayesha Khan",
    handle: "ayesha_eats",
    standard: { preset: "certified", avoidAlcohol: true, preferHandSlaughter: true },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const result = await completeOnboarding("newbie", parsed.data, db);
  assert.deepEqual(
    { ok: result.ok, reason: result.ok ? null : result.reason },
    { ok: false, reason: "standard" },
  );
  const after = await getOrCreateProfile("newbie", db);
  assert.equal(after.handle, before.handle);
  assert.equal(after.onboardedAt, null);
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM user_profiles`).get() as { n: number }).n,
    1,
  );
});

test("two accounts can follow, share a visit, send a rec and answer it", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "ayesha");
  addUser(sqlite, "zaid");
  insertPlace(sqlite);
  const ayesha = validateOnboarding({ displayName: "Ayesha", handle: "ayesha_eats" });
  const zaid = validateOnboarding({ displayName: "Zaid", handle: "zaid_bites" });
  if (!ayesha.ok || !zaid.ok) throw new Error("onboarding");
  assert.equal((await completeOnboarding("ayesha", ayesha.data, db)).ok, true);
  assert.equal((await completeOnboarding("zaid", zaid.data, db)).ok, true);
  assert.deepEqual(await followUser("zaid", "ayesha_eats", db), { ok: true, status: "accepted" });
  assert.deepEqual(await followUser("ayesha", "zaid_bites", db), { ok: true, status: "accepted" });

  const rec = validateRec({
    placeId: PLACE,
    recipients: ["zaid_bites"],
    note: "The kebabs were the thing to order.",
  });
  assert.equal(rec.ok, true);
  if (!rec.ok) return;
  const sent = await sendRecs("ayesha", rec.rec, db);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.deepEqual(sent.outcomes, [{ handle: "zaid_bites", status: "sent" }]);
  const incoming = await listNotifications("zaid", "all", db);
  assert.ok(incoming.some((item) => item.kind === "rec"));

  const recId = (
    sqlite.prepare(`SELECT id FROM recs WHERE recipient_id = 'zaid'`).get() as { id: string }
  ).id;
  assert.deepEqual(await replyToRec(recId, "zaid", "in", db), { ok: true, reply: "in" });
  const answered = await listNotifications("ayesha", "all", db);
  assert.ok(answered.some((item) => item.kind === "rec-reply"));
});
