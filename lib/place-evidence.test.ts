import { test } from "vitest";
import assert from "node:assert/strict";
import { validateCheck, type CheckInput } from "@/lib/core/check";
import { createCheck, recomputePlaceStatus } from "./checks-repository";
import {
  listPendingEvidence,
  reviewEvidence,
  submitEvidence,
  upsertListingSignal,
  validateEvidence,
} from "./place-evidence";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";

let keyCounter = 0;
function input(overrides: Record<string, unknown> = {}): CheckInput {
  keyCounter += 1;
  const result = validateCheck({
    owned: "yes",
    certified: "unsure",
    pork: "no",
    alcohol: "no",
    idempotencyKey: `evidence-${String(keyCounter).padStart(8, "0")}`,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["a", "b", "c", "mod"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id);
  }
  const place = addPlace(sqlite, { name: "Noor Grill House" });
  let photos = 0;
  const photo = (userId = "a", placeId = place) => {
    photos += 1;
    const id = `photo-${photos}`;
    sqlite
      .prepare(`INSERT INTO place_photos (id, place_id, user_id, r2_key, content_type, byte_size, created_at) VALUES (?, ?, ?, ?, 'image/jpeg', 100, ?)`)
      .run(id, placeId, userId, `places/${id}.jpg`, Date.now());
    return id;
  };
  const status = () => sqlite.prepare(`SELECT * FROM place_status WHERE place_id = ?`).get(place) as Record<string, unknown>;
  return { sqlite, db, place, photo, status };
}

function certificate(photoId: string, extra: Record<string, unknown> = {}) {
  const parsed = validateEvidence({ kind: "certificate", photoId, ...extra });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

test("validateEvidence: a certificate says certified; a menu says what it shows", () => {
  assert.deepEqual(certificate("p1").answers, { certified: "yes" });
  const menu = validateEvidence({ kind: "menu", photoId: "p1", pork: "no", alcohol: "yes", owned: "yes" });
  assert.ok(menu.ok);
  assert.deepEqual(menu.ok && menu.value.answers, { pork: "no", alcohol: "yes" });
  assert.equal(validateEvidence({ kind: "menu", photoId: "p1" }).ok, false);
  assert.equal(validateEvidence({ kind: "receipt", photoId: "p1" }).ok, false);
  assert.equal(validateEvidence({ kind: "certificate" }).ok, false);
  const now = Date.parse("2026-10-05T12:00:00Z");
  assert.equal(validateEvidence({ kind: "certificate", photoId: "p1", expiresOn: "2026-10-04" }, now).ok, false);
  assert.equal(validateEvidence({ kind: "certificate", photoId: "p1", expiresOn: "05/10/2027" }, now).ok, false);
  const good = validateEvidence({ kind: "certificate", photoId: "p1", expiresOn: "2026-10-05", certifier: "  HMC  " }, now);
  assert.ok(good.ok);
  assert.equal(good.ok && good.value.certifier, "HMC");
  assert.equal(good.ok && good.value.expiresAt, Date.parse("2026-10-06T00:00:00Z"));
});

test("a certificate only counts once a moderator approves it", async () => {
  const { db, place, photo, status } = world();
  let now = Date.now();
  for (const user of ["a", "b", "c"]) await createCheck(user, place, input(), db, (now += 1000));
  assert.equal(status().status, "checking");

  const sent = await submitEvidence("a", place, certificate(photo()), db, (now += 1000));
  assert.ok(sent.ok);
  await recomputePlaceStatus(place, db, (now += 1000));
  assert.equal(status().certified_value, null);

  const queue = await listPendingEvidence(db);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].submittedBy, "a");

  const reviewed = await reviewEvidence(sent.ok ? sent.value.id : "", "mod", "approve", null, db, (now += 1000));
  assert.ok(reviewed.ok);
  assert.deepEqual(reviewed.ok && reviewed.value.recompute.after, { kind: "verified" });
  const row = status();
  assert.equal(row.certified_value, "yes");
  assert.equal(row.certified_sources, "certificate");
  assert.equal(row.owned_sources, "community");
  assert.equal((await listPendingEvidence(db)).length, 0);

  const again = await reviewEvidence(sent.ok ? sent.value.id : "", "mod", "reject", null, db, (now += 1000));
  assert.deepEqual(again, { ok: false, status: 409, error: "That evidence was already reviewed." });
});

test("a rejected menu never counts, and someone else's photo is refused", async () => {
  const { db, place, photo, status } = world();
  const notMine = await submitEvidence("b", place, certificate(photo("a")), db);
  assert.equal(notMine.ok, false);

  const menu = validateEvidence({ kind: "menu", photoId: photo("a"), alcohol: "yes" });
  assert.ok(menu.ok);
  const sent = await submitEvidence("a", place, menu.ok ? menu.value : (null as never), db);
  assert.ok(sent.ok);
  await reviewEvidence(sent.ok ? sent.value.id : "", "mod", "reject", "Blurry", db);
  assert.equal(status().alcohol_value, null);
});

test("an approved menu that disagrees with three checks leaves the fact disputed", async () => {
  const { db, place, photo, status } = world();
  let now = Date.now();
  for (const user of ["a", "b", "c"]) await createCheck(user, place, input({ certified: "yes" }), db, (now += 1000));
  assert.equal(status().status, "verified");
  const menu = validateEvidence({ kind: "menu", photoId: photo("a"), alcohol: "yes" });
  const sent = await submitEvidence("a", place, menu.ok ? menu.value : (null as never), db, (now += 1000));
  const reviewed = await reviewEvidence(sent.ok ? sent.value.id : "", "mod", "approve", null, db, (now += 1000));
  // The newer menu's answer shows; no check agrees with it yet.
  assert.deepEqual(reviewed.ok && reviewed.value.recompute.after, { kind: "checking", progress: 1 });
  const row = status();
  assert.equal(row.disputed_facts, "alcohol");
  assert.equal(row.alcohol_value, "yes");
});

test("an expired certificate stops counting", async () => {
  const { db, place, photo, status } = world();
  const now = Date.now();
  const sent = await submitEvidence("a", place, { ...certificate(photo()), expiresAt: now + DAY }, db, now);
  await reviewEvidence(sent.ok ? sent.value.id : "", "mod", "approve", null, db, now);
  assert.equal(status().certified_value, "yes");
  await recomputePlaceStatus(place, db, now + 2 * DAY);
  assert.equal(status().certified_value, null);
});

test("a map listing is context: it fills in a value but leaves the place unchecked", async () => {
  const { db, place, status } = world();
  const first = await upsertListingSignal({ placeId: place, provider: "osm", externalId: "node/1", claim: "only" }, db);
  assert.equal(first.changed, true);
  let row = status();
  assert.equal(row.status, "unchecked");
  assert.equal(row.pork_value, "no");
  assert.equal(row.pork_settled, null);
  assert.equal(row.pork_sources, "listing");
  assert.equal(row.listing_claim, "only");

  const same = await upsertListingSignal({ placeId: place, provider: "osm", externalId: "node/1", claim: "only" }, db);
  assert.equal(same.changed, false);
  await upsertListingSignal({ placeId: place, provider: "osm", externalId: "node/1", claim: "yes" }, db);
  row = status();
  assert.equal(row.listing_claim, "yes");
  assert.equal(row.pork_value, null);
});
