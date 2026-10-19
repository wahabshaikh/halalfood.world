import { sql } from "drizzle-orm";
import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { env } from "@/lib/testing/cloudflare-workers";
import { flagVouches, listOpenFlags, reviewFlag } from "./contribution-flags";
import { vouchForPlace } from "./vouches";
import { recomputeTrust } from "./trust";
import { deleteAccount } from "./profiles";
import { POST } from "@/app/api/admin/flags/[id]/route";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const MINUTE = 60_000;
const input = { ateAt: "2026-10", rating: null, note: null };
function world() {
  const test = createTestDatabase();
  for (const id of ["a", "b", "c", "mod"]) {
    addUser(test.sqlite, id, id, NOW - 60 * DAY);
    addProfile(test.sqlite, id);
  }
  test.sqlite.prepare("INSERT INTO moderators (user_id, created_at) VALUES ('mod', ?)").run(NOW);
  const place = addPlace(test.sqlite);
  const vouch = (user = "a", target = place, now = NOW, ip = "203.0.113.1") =>
    vouchForPlace(user, target, input, { channel: "web", ip }, test.db, now);
  return { ...test, place, vouch };
}

test("velocity starts at six vouches, includes the window, and never blocks the write", async () => {
  const { db, vouch, sqlite } = world();
  for (let i = 0; i < 5; i++) assert.ok((await vouch("a", addPlace(sqlite), NOW + i)).ok);
  assert.equal((await listOpenFlags(db)).length, 0);
  const last = await vouch("a", addPlace(sqlite), NOW + 5);
  assert.ok(last.ok);
  assert.equal(last.value.points, 3);
  const [flag] = await listOpenFlags(db);
  assert.match(flag.label, /5 vouches/);
  assert.equal(flag.contributions.length, 6);
  assert.equal(new Set(flag.contributions.map((row) => row.place)).size, 6);
});

test("old vouches do not trigger velocity or distance; missing coordinates are safe", async () => {
  const { db, sqlite, vouch } = world();
  for (let i = 0; i < 5; i++) await vouch("a", addPlace(sqlite), NOW - 11 * MINUTE);
  await vouch("a", addPlace(sqlite, { lat: null, lng: null }));
  await vouch("b", addPlace(sqlite, { lat: 0, lng: 0 }), NOW - 61 * MINUTE);
  await vouch("b", addPlace(sqlite));
  assert.deepEqual(await listOpenFlags(db), []);
});

test("distance snapshots both contributions over 100 km apart within an hour", async () => {
  const { db, sqlite, vouch } = world();
  await vouch("a", addPlace(sqlite, { lat: 0, lng: 0 }), NOW - 60 * MINUTE);
  await vouch("a", addPlace(sqlite, { lat: 0, lng: 0.5 }), NOW - 59 * MINUTE);
  assert.equal((await listOpenFlags(db)).length, 0);
  await vouch("a", addPlace(sqlite, { lat: 0, lng: 2 }));
  const [flag] = await listOpenFlags(db);
  assert.match(flag.label, /100 km/);
  assert.equal(flag.contributions.length, 3);
});

test("self-vouch flags only New tier, including the account-only tier fallback", async () => {
  const { db, sqlite, place, vouch } = world();
  sqlite.prepare("UPDATE places SET submitted_by_user_id = 'a' WHERE id = ?").run(place);
  await vouch();
  assert.match((await listOpenFlags(db))[0].label, /own addition/);
  sqlite.prepare("INSERT INTO member_trust (user_id, tier, weight, updated_at) VALUES ('a', 'member', 1, ?)").run(NOW);
  await vouch("a", place, NOW + 1);
  await vouch("b", place, NOW + 2);
  assert.equal((await listOpenFlags(db)).length, 1);
});

test("a /24 cluster snapshots all three members and identical recomputes do not duplicate it", async () => {
  const { db, place, vouch } = world();
  await vouch("a");
  await vouch("b", place, NOW + 1, "203.0.113.2");
  assert.equal((await listOpenFlags(db)).length, 0);
  const result = await vouch("c", place, NOW + 2, "203.0.113.254");
  assert.ok(result.ok);
  assert.equal(result.value.trust.communityVouchers, 1);
  const [flag] = await listOpenFlags(db);
  assert.match(flag.label, /Same-network/);
  assert.equal(flag.contributions.length, 3);
  assert.deepEqual(new Set(flag.contributions.map((row) => row.user)), new Set(["a", "b", "c"]));
  await flagVouches("c", place, result.value.contributionId, result.value.trust, db, NOW + 3);
  assert.equal((await listOpenFlags(db)).length, 1);
});

for (const action of ["dismiss", "uphold"] as const) {
  test(`${action} is audited, recorded once and ${action === "uphold" ? "rejects contributions and revokes points across places" : "preserves contributions and points"}`, async () => {
    const { db, sqlite, vouch } = world();
    const places = Array.from({ length: 6 }, () => addPlace(sqlite));
    for (const place of places) await vouch("a", place);
    const [flag] = await listOpenFlags(db);
    const result = await reviewFlag(flag.id, "mod", { action, reason: "Checked the member history" }, db, NOW + 1);
    assert.deepEqual(result, { ok: true });
    const row = sqlite.prepare("SELECT * FROM contribution_flags WHERE id = ?").get(flag.id)!;
    assert.equal(row.status, action === "uphold" ? "upheld" : "dismissed");
    assert.equal(row.reviewed_by, "mod");
    assert.equal(row.reviewed_at, NOW + 1);
    assert.equal(row.reason, "Checked the member history");
    assert.equal((await listOpenFlags(db)).length, 0);
    const contributions = sqlite.prepare("SELECT status, weight, reason FROM contributions").all();
    assert.ok(contributions.every((row) => row.status === (action === "uphold" ? "rejected" : "accepted")));
    if (action === "uphold") assert.ok(contributions.every((row) => row.weight === 0 && row.reason === "Checked the member history"));
    const points = sqlite.prepare("SELECT status FROM contribution_points").all();
    assert.ok(points.every((row) => row.status === (action === "uphold" ? "revoked" : "granted")));
    for (const place of places) {
      const status = sqlite.prepare("SELECT community_vouchers, status FROM place_status WHERE place_id = ?").get(place)!;
      assert.equal(status.community_vouchers, action === "uphold" ? 0 : 1);
      assert.equal(status.status, "unchecked", "flag decisions never affect halal status");
    }
    const [audit] = sqlite.prepare("SELECT * FROM audit_log").all();
    assert.equal(audit.action, `flag-${action}`);
    assert.equal(audit.actor_user_id, "mod");
    assert.equal(JSON.parse(String(audit.after_value)).contributionIds.length, 6);
    assert.equal((await reviewFlag(flag.id, "mod", { action, reason: "Again" }, db)).ok, false);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_log").get()!.n, 1);
  });
}

test("upholding a cluster revokes pending points as well as granted points", async () => {
  const { db, sqlite, place, vouch } = world();
  for (const user of ["a", "b", "c"]) await vouch(user);
  const [flag] = await listOpenFlags(db);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM contribution_points WHERE status = 'pending'").get()!.n, 1);
  await reviewFlag(flag.id, "mod", { action: "uphold", reason: "Coordinated" }, db);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM contribution_points WHERE status = 'revoked'").get()!.n, 3);
  assert.equal((await recomputeTrust(place, db, NOW)).communityVouchers, 0);
});

test("account deletion removes cluster snapshots that mention another member", async () => {
  const { db, place, vouch } = world();
  for (const user of ["a", "b", "c"]) await vouch(user);
  assert.equal((await listOpenFlags(db)).length, 1);
  await deleteAccount("a", db, NOW);
  assert.deepEqual(await listOpenFlags(db), []);
  assert.equal((await recomputeTrust(place, db, NOW)).communityVouchers, 2);
});

const auth = vi.hoisted(() => ({ userId: "mod" as string | null }));
vi.mock("@/lib/auth-session", () => ({ getRequestAuth: async () => auth.userId ? { status: "authenticated", userId: auth.userId } : { status: "unauthenticated" } }));
afterEach(() => { delete env.DB; auth.userId = "mod"; });
const post = (id: string, body: string) => POST(new Request(`http://localhost/api/admin/flags/${id}`, { method: "POST", body }), { params: Promise.resolve({ id }) });

test("review route enforces moderator auth, id and reason validation, and missing flags", async () => {
  const { binding } = world();
  env.DB = binding;
  const id = crypto.randomUUID();
  auth.userId = null;
  assert.equal((await post(id, "{}")).status, 401);
  auth.userId = "a";
  assert.equal((await post(id, "{}")).status, 403);
  auth.userId = "mod";
  assert.equal((await post("bad", "{}")).status, 400);
  assert.equal((await post(id, "not json")).status, 400);
  assert.equal((await post(id, JSON.stringify({ action: "uphold", reason: "" }))).status, 400);
  assert.equal((await post(id, JSON.stringify({ action: "uphold", reason: "Reviewed" }))).status, 404);
});

test("review route resolves a flag and returns conflict on repeated reviews", async () => {
  const { binding, db, vouch, sqlite, place } = world();
  env.DB = binding;
  sqlite.prepare("UPDATE places SET submitted_by_user_id = 'a' WHERE id = ?").run(place);
  await vouch();
  const [flag] = await listOpenFlags(db);
  const body = JSON.stringify({ action: "dismiss", reason: "Independent visit" });
  assert.equal((await post(flag.id, body)).status, 200);
  assert.equal((await post(flag.id, body)).status, 429, "reviews spend a per-user and per-IP budget");
  sqlite.exec("DELETE FROM auth_otp_rate_limit");
  assert.equal((await post(flag.id, body)).status, 409);
});

test("queue failures never block a saved vouch", async () => {
  const { db, sqlite, vouch } = world();
  sqlite.exec("DROP TABLE contribution_flags");
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (let i = 0; i < 6; i++) assert.ok((await vouch("a", addPlace(sqlite))).ok);
    assert.equal((await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM contributions`))[0].n, 6);
    assert.ok(spy.mock.calls.length > 0);
  } finally { spy.mockRestore(); }
});
