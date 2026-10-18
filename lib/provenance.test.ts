import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { validateCheck } from "@/lib/core/check";
import { HALALFOODNEARME_IMPORT } from "@/lib/core/provenance";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { createCheck } from "./checks-repository";
import { actOnReport } from "./moderation";
import { reviewEvidence, submitEvidence, upsertListingSignal, validateEvidence } from "./place-evidence";
import { countPlaces, explorePlaces, getPlaceById, listPlaceRefs } from "./places";
import { isUnverifiedPlace, recomputePlaceVerification } from "./provenance";
import { applyClaims } from "./scout/claims";
import { upsertCreator } from "./scout/creators";
import type { ScoutDeps } from "./scout/deps";
import { addVerification, removeVerification } from "./scout/verifications";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "migrations");
const IMPORTED_AT = HALALFOODNEARME_IMPORT.createdAt;
const NOW = Date.parse("2026-10-18T12:00:00Z");

/* ------------------------------------------------------------ migration */

function databaseBefore0007() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql") && name < "0007").sort())
    sqlite.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  return sqlite;
}

function insertPlace(sqlite: DatabaseSync, id: string, createdAt: number, submitter: string | null = null, listing = "listed") {
  sqlite
    .prepare(
      `INSERT INTO places (id, name, city_slug, street_address, submitted_by_user_id, listing_status, created_at, updated_at)
       VALUES (?, ?, 'london', ?, ?, ?, ?, ?)`,
    )
    .run(id, `Place ${id}`, `${id} Street`, submitter, listing, createdAt, createdAt);
  sqlite.prepare(`INSERT INTO place_status (place_id, updated_at) VALUES (?, ?)`).run(id, createdAt);
}

function insertUser(sqlite: DatabaseSync, id: string, createdAt: number) {
  sqlite
    .prepare(`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
    .run(id, id, `${id}@example.com`, createdAt, createdAt);
}

function insertCheck(sqlite: DatabaseSync, id: string, userId: string, placeId: string, createdAt: number, excluded = 0) {
  sqlite
    .prepare(
      `INSERT INTO checks (id, user_id, place_id, owned, idempotency_key, excluded, created_at) VALUES (?, ?, ?, 'yes', ?, ?, ?)`,
    )
    .run(id, userId, placeId, id, excluded, createdAt);
}

const provenance = (sqlite: DatabaseSync): Record<string, { source: unknown; verified: boolean }> =>
  Object.fromEntries(
    (sqlite.prepare(`SELECT id, import_source, import_verified_at FROM places ORDER BY id`).all() as Record<string, unknown>[]).map((row) => [
      row.id,
      { source: row.import_source, verified: row.import_verified_at !== null },
    ]),
  );

test("0007 flags exactly the import's millisecond with no submitter, and verifies those with evidence", () => {
  const sqlite = databaseBefore0007();
  const old = IMPORTED_AT - 400 * DAY;
  insertUser(sqlite, "veteran", old);
  insertUser(sqlite, "newcomer", NOW - 1000);
  insertUser(sqlite, "suspended", old);
  sqlite.prepare(`INSERT INTO profiles (user_id, handle, display_name, suspended_at, created_at, updated_at) VALUES ('suspended', 'suspended', 'S', 1, 1, 1)`).run();

  insertPlace(sqlite, "a-plain", IMPORTED_AT);
  insertPlace(sqlite, "a-hidden", IMPORTED_AT, null, "hidden");
  insertPlace(sqlite, "b-ms-before", IMPORTED_AT - 1);
  insertPlace(sqlite, "b-ms-after", IMPORTED_AT + 1);
  insertPlace(sqlite, "b-submitted", IMPORTED_AT, "veteran");
  insertPlace(sqlite, "b-slam-burger", 1790281853240);
  insertPlace(sqlite, "c-checked", IMPORTED_AT);
  insertCheck(sqlite, "k1", "veteran", "c-checked", NOW);
  insertPlace(sqlite, "c-young-check", IMPORTED_AT);
  insertCheck(sqlite, "k2", "newcomer", "c-young-check", NOW);
  insertPlace(sqlite, "c-excluded-check", IMPORTED_AT);
  insertCheck(sqlite, "k3", "veteran", "c-excluded-check", NOW, 1);
  insertPlace(sqlite, "c-suspended-check", IMPORTED_AT);
  insertCheck(sqlite, "k4", "suspended", "c-suspended-check", NOW);
  const signal = (id: string, placeId: string, source: string, status: string) =>
    sqlite
      .prepare(
        `INSERT INTO place_signals (id, place_id, source, provider, external_id, pork, review_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'no', ?, 1, 1)`,
      )
      .run(id, placeId, source, source === "listing" ? "osm" : null, source === "listing" ? `node/${id}` : null, status);
  insertPlace(sqlite, "d-menu", IMPORTED_AT);
  signal("s1", "d-menu", "menu", "approved");
  insertPlace(sqlite, "d-pending-certificate", IMPORTED_AT);
  signal("s2", "d-pending-certificate", "certificate", "pending");
  insertPlace(sqlite, "d-listing", IMPORTED_AT);
  signal("s3", "d-listing", "listing", "approved");
  insertPlace(sqlite, "e-creator", IMPORTED_AT);
  sqlite
    .prepare(
      `INSERT INTO creator_verifications (id, creator_user_id, place_id, video_id, video_url, created_at, updated_at)
       VALUES ('v1', 'veteran', 'e-creator', 'abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk', 1, 1)`,
    )
    .run();
  const claim = (id: string, placeId: string, fact: string, value: string) =>
    sqlite
      .prepare(
        `INSERT INTO place_claims (id, place_id, source, fact, value, source_url, created_at, updated_at) VALUES (?, ?, 'scout', ?, ?, 'https://example.com', 1, 1)`,
      )
      .run(id, placeId, fact, value);
  insertPlace(sqlite, "f-certified-claim", IMPORTED_AT);
  claim("c1", "f-certified-claim", "certified", "yes");
  insertPlace(sqlite, "f-other-claims", IMPORTED_AT);
  claim("c2", "f-other-claims", "owned", "yes");
  claim("c3", "f-other-claims", "certified", "no");

  const migration = readFileSync(join(MIGRATIONS, "0007_place_provenance.sql"), "utf8");
  assert.doesNotMatch(migration, /^\s*(BEGIN|COMMIT|ROLLBACK)\b/im, "D1 rejects explicit transactions");
  assert.doesNotMatch(migration, /\b(DROP|RENAME)\b/i, "additive only");
  sqlite.exec(migration);

  const imported = { source: HALALFOODNEARME_IMPORT.source, verified: false };
  const verified = { source: HALALFOODNEARME_IMPORT.source, verified: true };
  const untouched = { source: null, verified: false };
  const expected = {
    "a-hidden": imported,
    "a-plain": imported,
    "b-ms-after": untouched,
    "b-ms-before": untouched,
    "b-slam-burger": untouched,
    "b-submitted": untouched,
    "c-checked": verified,
    "c-excluded-check": imported,
    "c-suspended-check": imported,
    "c-young-check": imported,
    "d-listing": imported,
    "d-menu": verified,
    "d-pending-certificate": imported,
    "e-creator": verified,
    "f-certified-claim": verified,
    "f-other-claims": imported,
  };
  assert.deepEqual(provenance(sqlite), expected);

  // Re-running the backfill changes nothing, and keeps the first verification time.
  const firstVerifiedAt = sqlite.prepare(`SELECT import_verified_at AS at FROM places WHERE id = 'c-checked'`).get() as { at: number };
  sqlite.exec(migration.replace(/^ALTER TABLE.*$/gm, ""));
  assert.deepEqual(provenance(sqlite), expected);
  assert.deepEqual(sqlite.prepare(`SELECT import_verified_at AS at FROM places WHERE id = 'c-checked'`).get(), firstVerifiedAt);

  // The rollback clears the backfill and keeps the columns deployed code reads.
  const rollback = readFileSync(join(ROOT, "scripts/rollback/0007_place_provenance_down.sql"), "utf8");
  assert.doesNotMatch(rollback, /^\s*(BEGIN|COMMIT|DROP|ALTER)\b/im);
  sqlite.exec(rollback);
  sqlite.exec(rollback);
  assert.ok(Object.values(provenance(sqlite)).every((row) => row.source === null && !row.verified));
  const columns = (sqlite.prepare(`PRAGMA table_info(places)`).all() as { name: string }[]).map((column) => column.name);
  assert.ok(columns.includes("import_source") && columns.includes("import_verified_at"));
});

test("migration files are only the top-level numbered SQL; the rollback lives outside migrations/", () => {
  const names = readdirSync(MIGRATIONS);
  assert.ok(names.every((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)), names.join(", "));
});

/* ------------------------------------------------------------ write paths */

let keys = 0;
function answers(over: Record<string, unknown> = {}) {
  keys += 1;
  const parsed = validateCheck({ owned: "yes", certified: "unsure", pork: "no", alcohol: "no", idempotencyKey: `prov-${String(keys).padStart(8, "0")}`, ...over });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function world() {
  const test = createTestDatabase();
  for (const id of ["a", "b", "mod"]) {
    addUser(test.sqlite, id);
    addProfile(test.sqlite, id);
  }
  const imported = (name = "Imported Kebab House") => {
    const id = addPlace(test.sqlite, { name, city: "london" });
    test.sqlite.prepare(`UPDATE places SET import_source = 'halalfoodnear.me' WHERE id = ?`).run(id);
    return id;
  };
  const verifiedAt = (id: string) =>
    (test.sqlite.prepare(`SELECT import_verified_at AS at FROM places WHERE id = ?`).get(id) as { at: number | null }).at;
  const deps: ScoutDeps = { db: test.db, origin: "https://halalfood.world", now: () => NOW };
  return { ...test, imported, verifiedAt, deps };
}

test("a counted check verifies an imported place; excluding it makes the place unverified again", async () => {
  const { sqlite, db, imported, verifiedAt } = world();
  const place = imported();
  const created = await createCheck("a", place, answers(), db, NOW);
  assert.equal(verifiedAt(place), NOW);
  const card = (await getPlaceById(place, db))!.card;
  assert.equal(card.unverified, false);

  const report = crypto.randomUUID();
  sqlite
    .prepare(`INSERT INTO reports (id, target_type, target_id, reporter_id, reason, status, created_at, updated_at) VALUES (?, 'check', ?, 'mod', 'spam', 'open', 1, 1)`)
    .run(report, created.checkId);
  assert.deepEqual(await actOnReport(report, "mod", { action: "exclude-check" }, db, NOW + 1000), { ok: true });
  assert.equal(verifiedAt(place), null);
  assert.equal((await getPlaceById(place, db))!.card.unverified, true);
  // The flips moved the listing version on, so cached sitemaps refresh.
  const flips = sqlite.prepare(`SELECT after_value FROM audit_log WHERE actor_user_id = 'system:provenance' ORDER BY created_at`).all() as { after_value: string }[];
  assert.deepEqual(flips.map((row) => JSON.parse(row.after_value).change), ["import-verified", "import-unverified"]);
});

test("a check from a day-old account is needed, like for halal status", async () => {
  const { sqlite, db, imported, verifiedAt } = world();
  addUser(sqlite, "fresh", "fresh", NOW - 1000);
  const place = imported();
  await createCheck("fresh", place, answers(), db, NOW);
  assert.equal(verifiedAt(place), null);
});

test("an approved certificate or menu verifies it; a pending or rejected one and a map listing don't", async () => {
  const { sqlite, db, imported, verifiedAt } = world();
  const place = imported();
  const photo = (id: string) => {
    sqlite
      .prepare(`INSERT INTO place_photos (id, place_id, user_id, r2_key, content_type, byte_size, created_at) VALUES (?, ?, 'a', ?, 'image/jpeg', 100, 1)`)
      .run(id, place, `places/${id}.jpg`);
    return id;
  };
  await upsertListingSignal({ placeId: place, provider: "osm", externalId: "node/1", claim: "only" }, db, NOW);
  assert.equal(verifiedAt(place), null);

  const menu = validateEvidence({ kind: "menu", photoId: photo("p1"), pork: "no" });
  assert.ok(menu.ok);
  const rejected = await submitEvidence("a", place, menu.value, db, NOW);
  assert.ok(rejected.ok);
  await reviewEvidence(rejected.value.id, "mod", "reject", null, db, NOW);
  assert.equal(verifiedAt(place), null);

  const certificate = validateEvidence({ kind: "certificate", photoId: photo("p2") });
  assert.ok(certificate.ok);
  const sent = await submitEvidence("a", place, certificate.value, db, NOW);
  assert.ok(sent.ok);
  assert.equal(verifiedAt(place), null, "pending evidence doesn't count");
  await reviewEvidence(sent.value.id, "mod", "approve", null, db, NOW + 5);
  assert.equal(verifiedAt(place), NOW + 5);
});

test("a creator video verification verifies it, and removing it reverts", async () => {
  const { db, imported, verifiedAt, deps } = world();
  const place = imported();
  const creator = await upsertCreator(deps, { handle: "@halalfoodie", channel_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw", display_name: "Halal Foodie" });
  assert.ok(creator.ok);
  const added = await addVerification(deps, { creator: "@halalfoodie", place_id: place, video_url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.ok(added.ok);
  assert.equal(verifiedAt(place), NOW);
  // It is still not a halal check.
  assert.equal((await getPlaceById(place, db))!.card.status.kind, "unchecked");
  const removed = await removeVerification(deps, { id: added.ok ? added.verification.id : "" });
  assert.deepEqual(removed, { ok: true, removed: true, id: added.ok ? added.verification.id : null });
  assert.equal(verifiedAt(place), null);
});

test("a Scout certified = yes claim with a source verifies it; other claims don't, and withdrawing it reverts", async () => {
  const { imported, verifiedAt, deps } = world();
  const place = imported();
  await applyClaims(deps, place, { muslim_owned: { value: "yes", source_url: "https://example.com/about" } });
  assert.equal(verifiedAt(place), null);
  await applyClaims(deps, place, { halal_certified: { value: "yes", source_url: "https://example.com/halal", certifier_name: "HMC" } });
  assert.equal(verifiedAt(place), NOW);
  await applyClaims(deps, place, { halal_certified: { value: "unknown" } });
  assert.equal(verifiedAt(place), null);
});

test("merging a checked duplicate into an imported place verifies it", async () => {
  const { sqlite, db, imported, verifiedAt } = world();
  const kept = imported();
  const duplicate = addPlace(sqlite, { name: "Imported Kebab House (dup)", city: "london" });
  await createCheck("a", duplicate, answers(), db, NOW);
  const report = crypto.randomUUID();
  sqlite
    .prepare(`INSERT INTO reports (id, target_type, target_id, reporter_id, reason, status, created_at, updated_at) VALUES (?, 'place', ?, 'mod', 'duplicate', 'open', 1, 1)`)
    .run(report, duplicate);
  assert.deepEqual(await actOnReport(report, "mod", { action: "merge", intoPlaceId: kept }, db, NOW + 10), { ok: true });
  assert.equal(verifiedAt(kept), NOW + 10);
});

test("places that were not imported are never labelled or touched", async () => {
  const { sqlite, db, verifiedAt } = world();
  const place = addPlace(sqlite, { name: "Added By Someone", city: "london" });
  assert.deepEqual(await recomputePlaceVerification(place, db, NOW), { imported: false, verifiedAt: null, changed: false });
  await createCheck("a", place, answers(), db, NOW);
  assert.equal(verifiedAt(place), null);
  assert.equal((await getPlaceById(place, db))!.card.unverified, false);
  assert.deepEqual(await recomputePlaceVerification("no-such-place", db, NOW), { imported: false, verifiedAt: null, changed: false });
});

test("cards carry the label, and the sitemap leaves unverified imports out", async () => {
  const { sqlite, db, binding, imported } = world();
  const label = imported("Unverified Import");
  const ok = imported("Verified Import");
  const plain = addPlace(sqlite, { name: "Plain Place", city: "london" });
  await createCheck("a", ok, answers(), db, NOW);
  const cards = (await explorePlaces({ citySlug: "london" }, db)).places;
  assert.deepEqual(
    Object.fromEntries(cards.map((card) => [card.name, card.unverified])),
    { "Unverified Import": true, "Verified Import": false, "Plain Place": false },
  );
  // The sitemap reads go through database(), which reads the DB binding.
  const { env } = await import("cloudflare:workers");
  env.DB = binding;
  try {
    const refs = (await listPlaceRefs({ limit: 100, offset: 0 })).map((ref) => ref.id);
    assert.deepEqual(new Set(refs), new Set([ok, plain]));
    assert.equal(refs.includes(label), false);
    assert.equal(await countPlaces(), 2);
  } finally {
    delete env.DB;
  }
});

test("isUnverifiedPlace answers the Worker's noindex lookup", async () => {
  const { sqlite, db, imported } = world();
  const label = imported();
  const plain = addPlace(sqlite, { name: "Plain", city: "london" });
  assert.equal(await isUnverifiedPlace(label, db), true);
  assert.equal(await isUnverifiedPlace(plain, db), false);
  assert.equal(await isUnverifiedPlace("00000000-0000-4000-8000-00000000ffff", db), false);
  await createCheck("a", label, answers(), db, NOW);
  assert.equal(await isUnverifiedPlace(label, db), false);
});

test("removing a creator verification keeps a place verified while a counted check remains", async () => {
  const { sqlite, db, imported, verifiedAt, deps } = world();
  addUser(sqlite, "fresh", "fresh", NOW - 1000);
  const place = imported();
  await createCheck("fresh", place, answers(), db, NOW - 10);
  await upsertCreator(deps, { handle: "@halalfoodie", channel_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw", display_name: "Halal Foodie" });
  const added = await addVerification(deps, { creator: "@halalfoodie", place_id: place, video_url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.ok(added.ok);
  await createCheck("a", place, answers(), db, NOW - 5);
  assert.equal(verifiedAt(place), NOW, "the first time it was verified is kept");
  await removeVerification(deps, { id: added.verification.id });
  assert.equal(verifiedAt(place), NOW);
  // check-visibility: status — the test excludes the only counted check.
  sqlite.prepare(`UPDATE checks SET excluded = 1 WHERE user_id = 'a'`).run();
  assert.deepEqual(await recomputePlaceVerification(place, db, NOW + 1), { imported: true, verifiedAt: null, changed: true });
});
