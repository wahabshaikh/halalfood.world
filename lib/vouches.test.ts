import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { env } from "@/lib/testing/cloudflare-workers";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { VOUCHES_PER_DAY } from "@/lib/core/contributions";
import { hashNetwork, vouchForPlace } from "./vouches";
import { POST } from "@/app/api/places/[id]/vouch/route";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const web = (ip = "203.0.113.7") => ({ channel: "web" as const, ip });
const input = (overrides: Partial<{ ateAt: string; rating: "liked" | null; note: string | null }> = {}) => ({
  ateAt: "2026-10",
  rating: null,
  note: null,
  ...overrides,
});

function world() {
  const test = createTestDatabase();
  const { sqlite } = test;
  for (const id of ["a", "b"]) {
    addUser(sqlite, id, id, NOW - 60 * DAY);
    addProfile(sqlite, id);
  }
  addUser(sqlite, "young", "young", NOW - 2 * 60 * 60 * 1000);
  const place = addPlace(sqlite, { name: "Noor Grill House" });
  const rows = (table: string, where = "1") => sqlite.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`).all() as Record<string, unknown>[];
  return { ...test, place, rows };
}

test("a vouch is upserted, logged as a contribution and recomputes trust in the same call", async () => {
  const { db, place, rows } = world();
  const first = await vouchForPlace("a", place, input({ rating: "liked", note: "Great nihari" }), web(), db, NOW);
  assert.ok(first.ok);
  assert.equal(first.value.status, "accepted");
  assert.equal(first.value.weight, 0.5);
  assert.equal(first.value.points, 3);
  assert.equal(first.value.trust.communityVouchers, 1);
  const [stored] = rows("vouches");
  assert.equal(stored.rating, "liked");
  assert.equal(stored.note, "Great nihari");
  const [status] = rows("place_status");
  assert.equal(status.community_vouchers, 1);
  assert.equal(status.badges, "community_verified");

  const again = await vouchForPlace("a", place, input({ ateAt: "2026-09" }), web(), db, NOW + 1000);
  assert.ok(again.ok);
  assert.equal(again.value.points, 0, "a place pays a member once, ever");
  const vouches = rows("vouches");
  assert.equal(vouches.length, 1);
  assert.equal(vouches[0].ate_at, "2026-09");
  assert.equal(vouches[0].rating, null, "the latest vouch replaces the older one");
  const contributions = rows("contributions");
  assert.equal(contributions.length, 2);
  assert.ok(contributions.every((row) => row.status === "accepted" && row.channel === "web" && row.ref_id === `a:${place}`));
  assert.equal(contributions[0].ip_hash, await hashNetwork("203.0.113.200"), "the IP is stored as its hashed /24");
  assert.doesNotMatch(String(contributions[0].ip_hash), /203/);
  assert.deepEqual(rows("contribution_points").map((row) => [row.points, row.status, row.day]), [[3, "granted", "2026-10-18"]]);
});

test("a young account can vouch, but it stays pending with pending points until it counts", async () => {
  const { db, place, rows } = world();
  const young = await vouchForPlace("young", place, input(), web(), db, NOW);
  assert.ok(young.ok);
  assert.deepEqual([young.value.status, young.value.weight, young.value.points], ["pending", 0, 0]);
  assert.equal(young.value.trust.communityVouchers, 0);
  assert.deepEqual(rows("contribution_points").map((row) => [row.points, row.status]), [[3, "pending"]]);

  // Vouching again while pending updates that contribution rather than stacking another.
  await vouchForPlace("young", place, input(), web(), db, NOW + 1000);
  assert.equal(rows("contributions").length, 1);
  assert.equal(rows("contribution_points").length, 1);

  // A day later the re-vouch counts: the same contribution is accepted and its points granted.
  const later = await vouchForPlace("young", place, input(), web(), db, NOW + 2 * DAY);
  assert.ok(later.ok);
  assert.deepEqual([later.value.status, later.value.points], ["accepted", 3]);
  assert.deepEqual(rows("contributions").map((row) => row.status), ["accepted"]);
  assert.deepEqual(rows("contribution_points").map((row) => [row.points, row.status, row.day]), [[3, "granted", "2026-10-20"]]);
});

test("vouch points stop at 100 a UTC day", async () => {
  const { db, sqlite, place, rows } = world();
  sqlite
    .prepare(`INSERT INTO contributions (id, user_id, kind, channel, status, created_at) VALUES ('old', 'a', 'certificate', 'web', 'accepted', ?)`)
    .run(NOW - DAY);
  sqlite
    .prepare(
      `INSERT INTO contribution_points (id, user_id, contribution_id, kind, points, status, day, created_at) VALUES ('p', 'a', 'old', 'certificate', 98, 'granted', '2026-10-18', ?)`,
    )
    .run(NOW);
  const trimmed = await vouchForPlace("a", place, input(), web(), db, NOW);
  assert.ok(trimmed.ok);
  assert.equal(trimmed.value.points, 2, "the day ends on exactly 100");
  const other = addPlace(sqlite);
  const capped = await vouchForPlace("a", other, input(), web(), db, NOW);
  assert.ok(capped.ok);
  assert.deepEqual([capped.value.status, capped.value.points], ["accepted", 0]);
  assert.equal(rows("contribution_points", `place_id = '${other}'`).length, 0);
});

test("a member can vouch 20 times in 24 hours, and missing places are 404", async () => {
  const { db, sqlite } = world();
  for (let index = 0; index < VOUCHES_PER_DAY; index += 1) {
    const result = await vouchForPlace("b", addPlace(sqlite), input(), web(), db, NOW + index);
    assert.ok(result.ok);
  }
  const limited = await vouchForPlace("b", addPlace(sqlite), input(), web(), db, NOW + 100);
  assert.deepEqual(limited.ok ? null : limited.status, 429);
  const tomorrow = await vouchForPlace("b", addPlace(sqlite), input(), web(), db, NOW + DAY + 100);
  assert.ok(tomorrow.ok);
  const missing = await vouchForPlace("b", "3f2504e0-4f89-11d3-9a0c-999999999999", input(), web(), db, NOW + DAY + 200);
  assert.deepEqual(missing, { ok: false, status: 404, error: "That place could not be found." });
});

test("an unparseable IP is stored without a network hash", async () => {
  assert.equal(await hashNetwork("unknown"), null);
});

const auth = vi.hoisted(() => ({ userId: "a" as string | null }));
vi.mock("@/lib/auth-session", () => ({
  getRequestAuth: async () => (auth.userId ? { status: "authenticated", userId: auth.userId } : { status: "unauthenticated" }),
}));

let routePlace = "";
beforeEach(() => {
  const { sqlite, binding } = createTestDatabase();
  addUser(sqlite, "a");
  routePlace = addPlace(sqlite);
  env.DB = binding;
  auth.userId = "a";
});
afterEach(() => {
  delete env.DB;
});
const post = (id: string, body: string) =>
  POST(
    new Request(`http://localhost:5173/api/places/${id}/vouch`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.4" }, body }),
    { params: Promise.resolve({ id }) },
  );

test("the vouch route needs a session, valid input and a real place", async () => {
  assert.equal((await post("not-a-place", "{}")).status, 400);
  auth.userId = null;
  const signedOut = await post(routePlace, "{}");
  assert.equal(signedOut.status, 401);
  assert.match((await signedOut.json()).loginUrl, /login/);
  auth.userId = "a";
  assert.equal((await post(routePlace, "nope")).status, 400);
  assert.deepEqual(await (await post(routePlace, JSON.stringify({ rating: "meh" }))).json(), { error: "Choose disliked, liked or loved." });
  assert.equal((await post("3f2504e0-4f89-11d3-9a0c-999999999999", "{}")).status, 404);
});

test("the vouch route records a counted vouch and reports trust and points", async () => {
  const response = await post(routePlace, JSON.stringify({ ateAt: new Date().toISOString().slice(0, 7), rating: "loved", note: "Lovely" }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, "accepted");
  assert.equal(body.points, 3);
  assert.equal(body.trust.communityVouchers, 1);
  assert.match(body.message, /counts/);
});
