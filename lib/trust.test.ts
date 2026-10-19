import { test } from "vitest";
import assert from "node:assert/strict";
import { validateCheck, type CheckInput } from "@/lib/core/check";
import { createCheck } from "./checks-repository";
import { actOnReport } from "./moderation";
import { reviewEvidence, submitEvidence, validateEvidence } from "./place-evidence";
import { upsertCreator } from "./scout/creators";
import type { ScoutDeps } from "./scout/deps";
import { setMenuCheck, upsertMenu } from "./scout/menus";
import { addVerification, removeVerification } from "./scout/verifications";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { computeTrust, recomputeTrust } from "./trust";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const VIDEO = "dQw4w9WgXcQ";

let keyCounter = 0;
function input(overrides: Record<string, unknown> = {}): CheckInput {
  keyCounter += 1;
  const result = validateCheck({
    owned: "yes",
    certified: "yes",
    pork: "no",
    alcohol: "no",
    idempotencyKey: `trust-${String(keyCounter).padStart(8, "0")}`,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function world() {
  const test = createTestDatabase();
  const { sqlite } = test;
  for (const id of ["a", "b", "c", "mod"]) {
    addUser(sqlite, id, id, NOW - 60 * DAY);
    addProfile(sqlite, id);
  }
  const place = addPlace(sqlite, { name: "Noor Grill House" });
  const trust = (id = place) =>
    ({
      ...(sqlite
        .prepare(`SELECT trust_score, trust_band, community_vouchers, creator_count, badges FROM place_status WHERE place_id = ?`)
        .get(id) as object),
    }) as Record<string, unknown>;
  const deps: ScoutDeps = { db: test.db, origin: "https://halalfood.world", now: () => NOW };
  return { ...test, place, trust, deps };
}

/** A vouch, with its contribution row and, if given, the member's stored tier. */
function vouch(
  sqlite: ReturnType<typeof world>["sqlite"],
  userId: string,
  placeId: string,
  options: { at?: number; tier?: string; weight?: number; ipHash?: string; status?: string } = {},
) {
  const at = options.at ?? NOW - DAY;
  sqlite
    .prepare(`INSERT INTO vouches (user_id, place_id, ate_at, created_at, updated_at) VALUES (?, ?, '2026-10', ?, ?)`)
    .run(userId, placeId, at, at);
  sqlite
    .prepare(
      `INSERT INTO contributions (id, user_id, kind, place_id, ref_table, ref_id, channel, status, ip_hash, created_at)
       VALUES (?, ?, 'vouch', ?, 'vouches', ?, 'web', ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), userId, placeId, `${userId}:${placeId}`, options.status ?? "accepted", options.ipHash ?? null, at);
  if (options.tier)
    sqlite
      .prepare(`INSERT INTO member_trust (user_id, tier, weight, updated_at) VALUES (?, ?, ?, ?)`)
      .run(userId, options.tier, options.weight ?? 1, at);
}

test("a creator verification makes a place Creator verified, and removing it takes that away", async () => {
  const { place, trust, deps } = world();
  assert.deepEqual(trust(), { trust_score: 0, trust_band: "unverified", community_vouchers: 0, creator_count: 0, badges: "" });
  const creator = await upsertCreator(deps, { handle: "@HalalFoodie", channel_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw", display_name: "Halal Foodie" });
  assert.ok(creator.ok);
  const added = await addVerification(deps, { creator: "@HalalFoodie", place_id: place, video_url: VIDEO });
  assert.ok(added.ok);
  assert.deepEqual(trust(), { trust_score: 15, trust_band: "some_proof", community_vouchers: 0, creator_count: 1, badges: "creator_verified" });
  await removeVerification(deps, { id: added.verification.id });
  assert.deepEqual(trust(), { trust_score: 0, trust_band: "unverified", community_vouchers: 0, creator_count: 0, badges: "" });
});

test("checks that settle all four facts add to trust in the same request", async () => {
  const { db, place, trust } = world();
  await createCheck("a", place, input(), db, NOW);
  assert.equal(trust().trust_score, 0);
  await createCheck("b", place, input(), db, NOW + 1000);
  await createCheck("c", place, input(), db, NOW + 2000);
  // All four settled: +10, still Unverified; settled no-pork and no-alcohol earn no badge.
  assert.deepEqual(trust(), { trust_score: 10, trust_band: "unverified", community_vouchers: 0, creator_count: 0, badges: "" });
});

test("an approved certificate gives proof and the Halal Certified badge; an expired one doesn't", async () => {
  const { sqlite, db, place, trust } = world();
  sqlite
    .prepare(`INSERT INTO place_photos (id, place_id, user_id, r2_key, content_type, byte_size, created_at) VALUES ('p1', ?, 'a', 'places/p1.jpg', 'image/jpeg', 100, ?)`)
    .run(place, NOW);
  const parsed = validateEvidence({ kind: "certificate", photoId: "p1" });
  assert.ok(parsed.ok);
  const sent = await submitEvidence("a", place, { ...parsed.value, expiresAt: NOW + DAY }, db, NOW);
  assert.ok(sent.ok);
  assert.equal(trust().trust_score, 0);
  await reviewEvidence(sent.value.id, "mod", "approve", null, db, NOW);
  assert.deepEqual(trust(), { trust_score: 40, trust_band: "trusted", community_vouchers: 0, creator_count: 0, badges: "halal_certified" });
  assert.equal((await recomputeTrust(place, db, NOW + 2 * DAY)).trustScore, 0);
});

test("counted vouches use member weights; rejected, suspended and same-network vouches don't add up", async () => {
  const { sqlite, db, place } = world();
  vouch(sqlite, "a", place, { tier: "trusted", weight: 1.5 });
  // No member_trust row yet: worked out from the account (60 days, verified email → New, 0.5).
  vouch(sqlite, "b", place);
  vouch(sqlite, "c", place, { tier: "member", weight: 1, status: "rejected" });
  addUser(sqlite, "s", "s", NOW - 60 * DAY);
  addProfile(sqlite, "s");
  sqlite.prepare(`UPDATE profiles SET suspended_at = ? WHERE user_id = 's'`).run(NOW);
  vouch(sqlite, "s", place, { tier: "trusted", weight: 1.5 });
  const first = await computeTrust(place, db, NOW);
  assert.equal(first.communityVouchers, 2);
  // W = 2 → 6·log2(3) ≈ 9.5.
  assert.equal(first.trustScore, 10);
  assert.equal(first.badges, "community_verified");

  // Three vouches from one network within a day: only the heaviest counts, and the cluster is reported.
  const other = addPlace(sqlite, { name: "Noor Grill Too" });
  vouch(sqlite, "a", other, { ipHash: "net", at: NOW - 3000 });
  vouch(sqlite, "b", other, { ipHash: "net", at: NOW - 2000 });
  vouch(sqlite, "s", other, { ipHash: "net", at: NOW - 1000 });
  const clustered = await computeTrust(other, db, NOW);
  assert.equal(clustered.communityVouchers, 1);
  assert.deepEqual(clustered.clusters, [["a", "b", "s"]]);
});

test("open reports cost trust; pork on the menu caps it at 14 and asks for review", async () => {
  const { sqlite, db, place, trust, deps } = world();
  sqlite.prepare(`INSERT INTO creator_verifications (id, creator_user_id, place_id, video_id, video_url, created_at, updated_at) VALUES ('cv1', 'a', ?, ?, 'https://www.youtube.com/watch?v=x', 1, 1)`).run(place, VIDEO);
  sqlite.prepare(`INSERT INTO creator_verifications (id, creator_user_id, place_id, video_id, video_url, created_at, updated_at) VALUES ('cv2', 'b', ?, ?, 'https://www.youtube.com/watch?v=x', 1, 1)`).run(place, VIDEO);
  assert.equal((await recomputeTrust(place, db, NOW)).trustScore, 20);
  sqlite
    .prepare(`INSERT INTO reports (id, target_type, target_id, reporter_id, reason, status, created_at, updated_at) VALUES ('r1', 'place', ?, 'c', 'not halal', 'open', 1, 1)`)
    .run(place);
  assert.equal((await recomputeTrust(place, db, NOW)).trustScore, 10);
  sqlite.prepare(`UPDATE reports SET status = 'dismissed'`).run();

  const menu = await upsertMenu(deps, {
    place_id: place,
    currency: "GBP",
    items: [{ name: "Pork ribs", price: 12 }, { name: "Beer", price: 5 }],
    sources: [{ url: "https://noor.example/menu", type: "website" }],
  });
  assert.ok(menu.ok);
  assert.equal(trust().trust_score, 25);
  const checked = await setMenuCheck(deps, {
    place_id: place,
    status: "flagged",
    flags: [
      { item: "Pork ribs", reason: "pork" },
      { item: "Beer", reason: "alcohol" },
    ],
  });
  assert.ok(checked.ok);
  assert.deepEqual(trust(), { trust_score: 14, trust_band: "unverified", community_vouchers: 0, creator_count: 2, badges: "creator_verified,serves_alcohol,serves_pork" });
  assert.equal((await computeTrust(place, db, NOW)).review, true);
});

test("a merge moves vouches and their contributions, and recomputes the kept place's trust", async () => {
  const { sqlite, db, place, trust } = world();
  const keep = addPlace(sqlite, { name: "Noor Grill House" });
  vouch(sqlite, "a", place, { tier: "member", weight: 1 });
  sqlite
    .prepare(`INSERT INTO reports (id, target_type, target_id, reporter_id, reason, status, created_at, updated_at) VALUES ('dup', 'place', ?, 'c', 'duplicate', 'open', 1, 1)`)
    .run(place);
  assert.deepEqual(await actOnReport("dup", "mod", { action: "merge", intoPlaceId: keep }, db, NOW), { ok: true });
  assert.deepEqual(trust(keep), { trust_score: 6, trust_band: "unverified", community_vouchers: 1, creator_count: 0, badges: "community_verified" });
  assert.ok(sqlite.prepare(`SELECT 1 FROM contributions WHERE place_id = ? AND ref_id = ?`).get(keep, `a:${keep}`));
});
