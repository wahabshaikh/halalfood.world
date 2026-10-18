import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, vi } from "vitest";
import { recomputePlaceStatus } from "@/lib/checks-repository";
import { explorePlaces, getPlaceById, searchPlaces } from "@/lib/places";
import { addPlace, addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { readWranglerConfig } from "@/lib/wrangler-config";
import { ADMIN_SECRET_MIN, adminSecret, checkAdminToken, timingSafeEqualString } from "./auth";
import { KeyedLock, MAX_BATCH, mapBounded } from "./batch";
import { upsertCreator, type UpsertCreatorInput } from "./creators";
import type { ScoutDeps } from "./deps";
import { allowWrites, MCP_WRITE_LIMITER_BINDING, MCP_WRITE_LIMITER_NAMESPACE, PREVIEW_MCP_WRITE_LIMITER_NAMESPACE, WRITE_LIMIT, WRITE_PERIOD_SECONDS, type WriteLimiter } from "./limits";
import { handleScoutRequest, MAX_BODY_BYTES, type ScoutEnvironment } from "./mcp";
import { findPlace, upsertPlace, type UpsertPlaceInput } from "./places";
import { TOOL_NAMES } from "./tools";
import { addVerification, removeVerification } from "./verifications";

const SECRET = "scout-test-secret-0123456789abcdef-xyz";
const ORIGIN = "https://halalfood.world";
const NOW = Date.parse("2026-10-18T12:00:00Z");
const CHANNEL = "UC_x5XG1OV2P6uZZ5FSM9Ttw";
const OTHER_CHANNEL = "UCaaaaaaaaaaaaaaaaaaaaaa";
const VIDEO = "dQw4w9WgXcQ";
const LONDON = { lat: 51.5145, lng: -0.0719 };

function setup() {
  const test = createTestDatabase();
  const deps: ScoutDeps = { db: test.db, origin: ORIGIN, now: () => NOW };
  return { ...test, deps };
}

const creator = (over: Partial<UpsertCreatorInput> = {}): UpsertCreatorInput => ({
  handle: "@HalalFoodie",
  channel_id: CHANNEL,
  display_name: "Halal Foodie",
  bio: "Eating my way around London.",
  avatar_url: "https://yt3.ggpht.com/avatar=s176",
  banner_url: "https://yt3.googleusercontent.com/banner=w1060",
  subscriber_count: 125_000,
  ...over,
});

const place = (over: Partial<UpsertPlaceInput> = {}): UpsertPlaceInput => ({
  name: "Dishoom Shoreditch",
  address: "7 Boundary St, London E2 7JE",
  city: "London",
  country: "United Kingdom",
  lat: LONDON.lat,
  lng: LONDON.lng,
  ...over,
});

const count = (sqlite: ReturnType<typeof setup>["sqlite"], sql: string, ...params: (string | number)[]) =>
  Number((sqlite.prepare(sql).get(...params) as { n: number }).n);

/* ------------------------------------------------------------------ auth */

test("the bearer secret is required, compared in constant time and never echoed", async () => {
  const req = (authorization?: string) => new Request(`${ORIGIN}/api/mcp`, { headers: authorization ? { authorization } : {} });
  assert.deepEqual(await checkAdminToken(req(`Bearer ${SECRET}`), SECRET).then((r) => r.ok), true);
  assert.match(JSON.stringify(await checkAdminToken(req(), SECRET)), /Missing bearer token/);
  assert.deepEqual(await checkAdminToken(req(`Bearer ${SECRET}x`), SECRET), { ok: false, error: "unauthorized", message: "Invalid bearer token." });
  assert.equal((await checkAdminToken(req(`Basic ${SECRET}`), SECRET)).ok, false);
  assert.equal((await checkAdminToken(req(`Bearer ${SECRET}`), undefined)).ok, false);
  assert.equal((await checkAdminToken(req("Bearer short"), "short")).ok, false);
  assert.equal(adminSecret("x".repeat(ADMIN_SECRET_MIN - 1)), undefined);
  assert.equal(adminSecret(` ${"x".repeat(ADMIN_SECRET_MIN)} `), "x".repeat(ADMIN_SECRET_MIN));
  const rejected = await checkAdminToken(req("Bearer guess-guess-guess"), SECRET);
  assert.equal(JSON.stringify(rejected).includes("guess"), false);
  const accepted = await checkAdminToken(req(`bearer ${SECRET}`), SECRET);
  assert.ok(accepted.ok && /^[0-9a-f]{16}$/.test(accepted.tokenId));
  assert.equal(JSON.stringify(accepted).includes(SECRET), false);
  assert.equal(await timingSafeEqualString("a", "a"), true);
  assert.equal(await timingSafeEqualString("a", "ab"), false);
});

/* ------------------------------------------------------------ MCP surface */

function mcpEnv(overrides: Partial<ScoutEnvironment> = {}) {
  const s = setup();
  const environment: ScoutEnvironment = { secret: SECRET, deps: async () => s.deps, ...overrides };
  return { ...s, environment };
}

async function post(environment: ScoutEnvironment, body: unknown, authorization: string | null = `Bearer ${SECRET}`, extra: Record<string, string> = {}) {
  return handleScoutRequest(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...(authorization ? { authorization } : {}), ...extra },
      body: JSON.stringify(body),
    }),
    environment,
  );
}

type RpcBody = { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string; annotations?: Record<string, boolean> }[] }; error?: { code: number; message: string } };

async function rpc(environment: ScoutEnvironment, method: string, params: unknown, authorization?: string | null) {
  const response = await post(environment, { jsonrpc: "2.0", id: 1, method, params }, authorization);
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return { status: response.status, body: JSON.parse(data ? data.slice(6) : text) as RpcBody };
}

async function call(environment: ScoutEnvironment, name: string, args: unknown) {
  const out = await rpc(environment, "tools/call", { name, arguments: args });
  const text = out.body.result!.content![0]!.text;
  return { isError: Boolean(out.body.result?.isError), text, body: text.startsWith("{") ? JSON.parse(text) : null };
}

test("without a secret on the Worker the endpoint is off, never open", async () => {
  for (const secret of [undefined, "", "too-short"]) {
    const { environment } = mcpEnv({ secret });
    const response = await post(environment, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error.message, /MCP_ADMIN_SECRET is not set/);
  }
});

test("a missing or wrong bearer token is a 401 and runs nothing", async () => {
  const { environment, sqlite } = mcpEnv();
  for (const authorization of [null, "Bearer wrong-wrong-wrong-wrong-wrong-wrong", `Basic ${SECRET}`]) {
    const response = await post(environment, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "upsert_creator", arguments: creator() } }, authorization);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="halalfood-scout"');
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_profiles"), 0);
});

test("GET and DELETE are 405, oversized bodies 413", async () => {
  const { environment } = mcpEnv();
  for (const method of ["GET", "DELETE"]) {
    const response = await handleScoutRequest(new Request(`${ORIGIN}/api/mcp`, { method, headers: { authorization: `Bearer ${SECRET}` } }), environment);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  }
  const big = await post(environment, { jsonrpc: "2.0", id: 1, method: "tools/list" }, `Bearer ${SECRET}`, { "content-length": String(MAX_BODY_BYTES + 1) });
  assert.equal(big.status, 413);
});

test("initialize and tools/list describe the Scout tools", async () => {
  const { environment } = mcpEnv();
  const init = await rpc(environment, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.status, 200);
  const list = await rpc(environment, "tools/list", {});
  const tools = list.body.result!.tools!;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
  assert.equal(tools.find((tool) => tool.name === "find_place")?.annotations?.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === "remove_verification")?.annotations?.destructiveHint, true);
});

test("the whole flow works through MCP, and a batch reports each item in order", async () => {
  const { environment, sqlite } = mcpEnv();
  const created = await call(environment, "upsert_creator", creator());
  assert.equal(created.isError, false);
  assert.equal(created.body.result, "created");
  const batch = await call(environment, "upsert_creators", {
    creators: [creator(), creator({ handle: "@sara.eats", channel_id: OTHER_CHANNEL, display_name: "Sara Eats" }), creator({ handle: "@bad-handle", channel_id: "UCbbbbbbbbbbbbbbbbbbbbbb" })],
  });
  assert.deepEqual(batch.body.summary, { failed: 1, updated: 1, created: 1 });
  assert.deepEqual(
    batch.body.results.map((r: { index: number; result?: string; error?: string }) => [r.index, r.result ?? r.error]),
    [
      [0, "updated"],
      [1, "created"],
      [2, "invalid_handle"],
    ],
  );
  const listed = await call(environment, "upsert_place", place());
  assert.equal(listed.body.result, "created");
  const found = await call(environment, "find_place", { name: "dishoom", city: "London" });
  assert.equal(found.body.candidates[0].id, listed.body.place.id);
  const verified = await call(environment, "add_verification", { creator: "@halalfoodie", place_id: listed.body.place.id, video_url: `https://youtu.be/${VIDEO}`, timestamp: "1:23", date: "2026-09-01" });
  assert.equal(verified.body.result, "created");
  assert.equal(verified.body.verification.video_url, `https://www.youtube.com/watch?v=${VIDEO}&t=83s`);
  const removed = await call(environment, "remove_verification", { id: verified.body.verification.id });
  assert.deepEqual(removed.body, { ok: true, removed: true, id: verified.body.verification.id });
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_verifications"), 0);
});

test("tool failures come back as isError with a clear code", async () => {
  const { environment } = mcpEnv();
  const bad = await call(environment, "upsert_creator", creator({ handle: "@halal-food-uk" }));
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error, "invalid_handle");
  const missingLng = await call(environment, "find_place", { name: "Dishoom", lat: 51.5 });
  assert.equal(missingLng.isError, true);
  assert.match(missingLng.text, /lat and lng together/);
  const nowhere = await call(environment, "find_place", { name: "Dishoom" });
  assert.match(nowhere.text, /Send a city/);
  const radius = await call(environment, "find_place", { name: "Dishoom", lat: 51.5, lng: 0, radius_m: 5000 });
  assert.equal(radius.isError, true);
  const channel = await call(environment, "upsert_creator", creator({ channel_id: "not-a-channel" }));
  assert.equal(channel.isError, true);
  assert.match(channel.text, /UC followed by 22/);
});

test("a batch over the cap is refused before anything runs", async () => {
  const { environment, sqlite } = mcpEnv();
  const out = await rpc(environment, "tools/call", {
    name: "upsert_places",
    arguments: { places: Array.from({ length: MAX_BATCH + 1 }, (_, i) => place({ name: `Place ${i}` })) },
  });
  assert.equal(out.body.result?.isError ?? Boolean(out.body.error), true);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 0);
});

test("writes are rate limited per token, item by item; reads are not", async () => {
  const keys: string[] = [];
  let left = 2;
  const limiter: WriteLimiter = {
    async limit({ key }) {
      keys.push(key);
      return { success: left-- > 0 };
    },
  };
  const { environment, sqlite } = mcpEnv({ limiter });
  const batch = await call(environment, "upsert_places", {
    places: [place(), place({ name: "Tayyabs", address: "83-89 Fieldgate St, London E1 1JU", lat: 51.5172, lng: -0.0635 }), place({ name: "Lahore Kebab House", address: "2-10 Umberston St, London E1 1PY", lat: 51.5139, lng: -0.0627 })],
  });
  assert.deepEqual(
    batch.body.results.map((r: { result?: string; error?: string }) => r.result ?? r.error),
    ["created", "created", "rate_limited"],
  );
  assert.match(batch.body.results[2].message, new RegExp(`${WRITE_LIMIT} writes per ${WRITE_PERIOD_SECONDS}s`));
  assert.equal(new Set(keys).size, 1);
  assert.match(keys[0]!, /^mcp-write:[0-9a-f]{16}$/);
  assert.equal(keys[0]!.includes(SECRET), false);
  const single = await call(environment, "upsert_creator", creator());
  assert.equal(single.isError, true);
  assert.equal(single.body.error, "rate_limited");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_profiles"), 0);
  const read = await call(environment, "find_place", { name: "Tayyabs", city: "London" });
  assert.equal(read.isError, false);
  assert.equal(read.body.candidates.length, 1);
});

test("allowWrites counts each item, fails closed per item, and is a no-op without the binding", async () => {
  assert.equal(await allowWrites(undefined, "t", 5), 5);
  assert.equal(await allowWrites(undefined, "t", 0), 0);
  let calls = 0;
  assert.equal(await allowWrites({ async limit() { calls += 1; return { success: calls <= 3 }; } }, "t", 5), 3);
  assert.equal(calls, 5);
  assert.equal(await allowWrites({ limit: () => Promise.reject(new Error("down")) }, "t", 2), 0);
});

test("the rate-limit binding is declared for production and previews in separate namespaces", () => {
  const config = readWranglerConfig();
  const top = config.ratelimits?.find((entry) => entry.name === MCP_WRITE_LIMITER_BINDING);
  const preview = config.previews?.ratelimits?.find((entry) => entry.name === MCP_WRITE_LIMITER_BINDING);
  assert.deepEqual(top, { name: MCP_WRITE_LIMITER_BINDING, namespace_id: MCP_WRITE_LIMITER_NAMESPACE, simple: { limit: WRITE_LIMIT, period: WRITE_PERIOD_SECONDS } });
  assert.deepEqual(preview, { name: MCP_WRITE_LIMITER_BINDING, namespace_id: PREVIEW_MCP_WRITE_LIMITER_NAMESPACE, simple: { limit: WRITE_LIMIT, period: WRITE_PERIOD_SECONDS } });
});

test("an unexpected database error is a safe-to-retry internal_error, without details", async () => {
  const { environment } = mcpEnv({ deps: async () => ({ db: { all: () => Promise.reject(new Error("D1_ERROR: secret detail")) } as never, origin: ORIGIN, now: () => NOW }) });
  const original = console.error;
  console.error = () => undefined;
  try {
    const out = await call(environment, "upsert_creator", creator());
    assert.equal(out.isError, true);
    assert.equal(out.body.error, "internal_error");
    assert.equal(out.text.includes("secret detail"), false);
  } finally {
    console.error = original;
  }
});

/* --------------------------------------------------------------- batches */

test("mapBounded keeps order and never runs more than its concurrency", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapBounded([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3);
  assert.deepEqual(await mapBounded([], 3, async () => 1), []);
});

test("KeyedLock runs holders of a key one after another, even after a failure", async () => {
  const lock = new KeyedLock();
  const order: string[] = [];
  const slow = lock.run(["a"], async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push("first");
    throw new Error("boom");
  });
  const second = lock.run(["a", "b"], async () => {
    order.push("second");
    return 2;
  });
  const other = lock.run(["c"], async () => {
    order.push("other");
    return 3;
  });
  await assert.rejects(slow, /boom/);
  assert.equal(await second, 2);
  assert.equal(await other, 3);
  assert.deepEqual(order, ["other", "first", "second"]);
});

/* -------------------------------------------------------------- creators */

test("upsert_creator creates an unclaimed creator who renders at /u/<handle> and can't sign in", async () => {
  const { deps, sqlite } = setup();
  const result = await upsertCreator(deps, creator());
  assert.deepEqual(result, { ok: true, result: "created", handle: "halalfoodie", channel_id: CHANNEL, url: `${ORIGIN}/u/halalfoodie`, claimed: false, warnings: [] });
  const row = sqlite
    .prepare(`SELECT u.email, u.email_verified, pr.handle, pr.display_name, pr.bio, pr.onboarded_at, cp.* FROM creator_profiles cp JOIN profiles pr USING (user_id) JOIN "user" u ON u.id = cp.user_id`)
    .get() as Record<string, unknown>;
  assert.match(String(row.email), /^creator-[0-9a-f-]{36}@unclaimed\.invalid$/);
  assert.equal(row.email_verified, 0);
  assert.equal(row.onboarded_at, null);
  assert.equal(row.handle, "halalfoodie");
  assert.equal(row.channel_handle, "halalfoodie");
  assert.equal(row.channel_url, "https://www.youtube.com/@halalfoodie");
  assert.equal(row.avatar_url, "https://yt3.ggpht.com/avatar=s176");
  assert.equal(row.subscriber_count, 125_000);
  assert.equal(row.claimed_at, null);
  assert.equal(row.source, "scout");
});

test("upsert_creator is idempotent on the channel id and updates what was sent", async () => {
  const { deps, sqlite } = setup();
  await upsertCreator(deps, creator());
  const again = await upsertCreator(deps, creator({ display_name: "Halal Foodie UK", subscriber_count: 130_000, bio: undefined, avatar_url: undefined }));
  assert.equal(again.ok && again.result, "updated");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_profiles"), 1);
  assert.equal(count(sqlite, `SELECT count(*) AS n FROM "user"`), 1);
  const row = sqlite.prepare(`SELECT pr.display_name, pr.bio, cp.subscriber_count, cp.avatar_url FROM creator_profiles cp JOIN profiles pr USING (user_id)`).get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, { display_name: "Halal Foodie UK", bio: "Eating my way around London.", subscriber_count: 130_000, avatar_url: "https://yt3.ggpht.com/avatar=s176" });
  const cleared = await upsertCreator(deps, creator({ bio: null, banner_url: null }));
  assert.equal(cleared.ok, true);
  assert.deepEqual({ ...(sqlite.prepare(`SELECT pr.bio, cp.banner_url FROM creator_profiles cp JOIN profiles pr USING (user_id)`).get() as object) }, { bio: null, banner_url: null });
});

test("a handle change follows the channel when the new handle is free, and is kept otherwise", async () => {
  const { deps, sqlite } = setup();
  await upsertCreator(deps, creator());
  const moved = await upsertCreator(deps, creator({ handle: "@halalfoodie.uk" }));
  assert.equal(moved.ok && moved.handle, "halalfoodie.uk");
  addUser(sqlite, "taken-user");
  addProfile(sqlite, "taken-user", { handle: "taken.handle" });
  const kept = await upsertCreator(deps, creator({ handle: "@taken.handle" }));
  assert.ok(kept.ok);
  assert.equal(kept.handle, "halalfoodie.uk");
  assert.match(kept.warnings.join(" "), /handle_kept/);
  assert.equal((sqlite.prepare(`SELECT channel_handle FROM creator_profiles`).get() as { channel_handle: string }).channel_handle, "taken.handle");
});

test("a claimed creator, or a person who signed up with the handle, is never changed", async () => {
  const { deps, sqlite } = setup();
  await upsertCreator(deps, creator());
  sqlite.prepare(`UPDATE creator_profiles SET claimed_at = 1`).run();
  const claimed = await upsertCreator(deps, creator({ display_name: "Overwritten" }));
  assert.ok(claimed.ok);
  assert.equal(claimed.result, "claimed");
  assert.equal(claimed.claimed, true);
  assert.equal((sqlite.prepare(`SELECT display_name FROM profiles`).get() as { display_name: string }).display_name, "Halal Foodie");

  addUser(sqlite, "sara");
  addProfile(sqlite, "sara", { handle: "sara.eats", name: "Sara" });
  const person = await upsertCreator(deps, creator({ handle: "@Sara.Eats", channel_id: OTHER_CHANNEL, display_name: "Not Sara" }));
  assert.ok(person.ok);
  assert.equal(person.result, "claimed");
  assert.match(person.warnings.join(" "), /person who signed up/);
  assert.equal((sqlite.prepare(`SELECT display_name FROM profiles WHERE user_id = 'sara'`).get() as { display_name: string }).display_name, "Sara");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_profiles"), 1);

  // A creator row whose user has a real email belongs to someone even without claimed_at.
  sqlite.prepare(`UPDATE creator_profiles SET claimed_at = NULL`).run();
  sqlite.prepare(`UPDATE "user" SET email = 'owner@example.com' WHERE email LIKE '%@unclaimed.invalid'`).run();
  const owned = await upsertCreator(deps, creator({ display_name: "Overwritten" }));
  assert.equal(owned.ok && owned.result, "claimed");
});

test("a handle that is another channel's creator profile is a conflict", async () => {
  const { deps } = setup();
  await upsertCreator(deps, creator());
  const other = await upsertCreator(deps, creator({ channel_id: OTHER_CHANNEL }));
  assert.equal(other.ok, false);
  assert.equal(!other.ok && other.error, "handle_taken");
});

test("creator inputs are cleaned: names and bios clipped, foreign images and channel URLs skipped", async () => {
  const { deps, sqlite } = setup();
  const result = await upsertCreator(
    deps,
    creator({ display_name: "A".repeat(80), bio: `${"b".repeat(300)}\u0007`, avatar_url: "https://evil.example/a.png", banner_url: "http://yt3.ggpht.com/b", channel_url: "https://evil.example/@x" }),
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.warnings.map((warning) => warning.split(":")[0]),
    ["display_name_clipped", "bio_clipped", "avatar_url_skipped", "banner_url_skipped", "channel_url_skipped"],
  );
  const row = sqlite.prepare(`SELECT pr.display_name, pr.bio, cp.avatar_url, cp.banner_url, cp.channel_url FROM creator_profiles cp JOIN profiles pr USING (user_id)`).get() as Record<string, string | null>;
  assert.equal(Array.from(row.display_name!).length, 60);
  assert.equal(Array.from(row.bio!).length, 160);
  assert.equal(row.avatar_url, null);
  assert.equal(row.banner_url, null);
  assert.equal(row.channel_url, "https://www.youtube.com/@halalfoodie");
  const kept = await upsertCreator(deps, creator({ channel_url: `https://youtube.com/channel/${CHANNEL}` }));
  assert.ok(kept.ok);
  assert.equal((sqlite.prepare(`SELECT channel_url FROM creator_profiles`).get() as { channel_url: string }).channel_url, `https://www.youtube.com/channel/${CHANNEL}`);
  const email = await upsertCreator(deps, creator({ channel_id: OTHER_CHANNEL, handle: "@mail.person", display_name: "me@example.com" }));
  assert.equal(!email.ok && email.error, "invalid_display_name");
});

/* ---------------------------------------------------------------- places */

test("find_place ranks by name and distance, by city, and by Google id", async () => {
  const { deps, sqlite } = setup();
  const near = addPlace(sqlite, { name: "Dishoom Shoreditch", city: "london", lat: LONDON.lat, lng: LONDON.lng });
  const branch = addPlace(sqlite, { name: "Dishoom Covent Garden", city: "london", lat: 51.5124, lng: -0.1269 });
  addPlace(sqlite, { name: "Pizza Hut", city: "london", lat: LONDON.lat, lng: LONDON.lng });
  sqlite.prepare(`UPDATE places SET google_place_id = 'ChIJgoogle123' WHERE id = ?`).run(branch);

  const byLocation = await findPlace(deps, { name: "Dishoom", lat: LONDON.lat, lng: LONDON.lng });
  assert.deepEqual(byLocation.candidates.map((c) => c.id), [near]);
  assert.equal(byLocation.candidates[0]!.distance_m, 0);
  assert.equal(byLocation.candidates[0]!.url, `${ORIGIN}/place/${near}`);

  const wide = await findPlace(deps, { name: "Dishoom", lat: LONDON.lat, lng: LONDON.lng, radius_m: 2000 });
  assert.equal(wide.candidates.length, 1); // Covent Garden is ~3.8 km away.

  const byCity = await findPlace(deps, { name: "Dishoom", city: "London" });
  assert.deepEqual(byCity.candidates.map((c) => c.id).sort(), [near, branch].sort());

  const byGoogle = await findPlace(deps, { name: "anything", google_place_id: "ChIJgoogle123" });
  assert.equal(byGoogle.candidates[0]!.id, branch);
  assert.equal(byGoogle.candidates[0]!.matched_by, "google_place_id");
});

test("find_place matches names longer than D1's 50-byte LIKE limit with instr()", async () => {
  const { deps, sqlite } = setup();
  const name = "Al-Madina Original Hyderabadi Dum Biryani & Kebab Corner Family Restaurant — Wembley";
  assert.ok(new TextEncoder().encode(name).length > 50);
  const id = addPlace(sqlite, { name, city: "wembley", lat: 51.5528, lng: -0.2967 });
  const found = await findPlace(deps, { name, city: "Wembley", lat: 51.5528, lng: -0.2967 });
  assert.equal(found.candidates[0]?.id, id);
  assert.equal(found.candidates[0]?.score, 1);
  // By city alone a same-name place ranks but is short of the same-place score: no street to confirm it.
  const byCity = await findPlace(deps, { name, city: "Wembley" });
  assert.equal(byCity.candidates[0]?.id, id);
  assert.ok(byCity.candidates[0]!.score < byCity.same_place_score);
  const percent = await findPlace(deps, { name: "100%_halal grill %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%", city: "Wembley" });
  assert.deepEqual(percent.candidates, []);
});

test("upsert_place lists a new place at once, unchecked, with no submitter, points or check", async () => {
  const { deps, sqlite } = setup();
  const result = await upsertPlace(deps, place({ google_place_id: "ChIJdishoom1", website: "https://www.dishoom.com/shoreditch", cuisine: ["Indian", "Indian", "Breakfast"] }));
  assert.ok(result.ok && result.result === "created");
  const row = sqlite.prepare(`SELECT * FROM places WHERE id = ?`).get(result.place.id) as Record<string, unknown>;
  assert.equal(row.listing_status, "listed");
  assert.equal(row.city_slug, "london");
  assert.equal(row.address_locality, "London");
  assert.equal(row.address_country, "United Kingdom");
  assert.equal(row.submitted_by_user_id, null);
  assert.equal(row.website, "https://www.dishoom.com/shoreditch");
  assert.equal(row.serves_cuisine, JSON.stringify(["Indian", "Breakfast"]));
  assert.match(String(row.maps_url), /query_place_id=ChIJdishoom1/);
  assert.equal((sqlite.prepare(`SELECT status FROM place_status WHERE place_id = ?`).get(result.place.id) as { status: string }).status, "unchecked");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM points"), 0);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM checks"), 0);
  assert.equal(result.place.url, `${ORIGIN}/place/${result.place.id}`);
});

test("upsert_place is idempotent: the same place matches instead of duplicating, and only blanks are filled", async () => {
  const { deps, sqlite } = setup();
  const first = await upsertPlace(deps, place());
  assert.ok(first.ok);
  const again = await upsertPlace(deps, place({ name: "Dishoom", lat: LONDON.lat + 0.0002, website: "https://dishoom.com", google_place_id: "ChIJdishoom1" }));
  assert.ok(again.ok && again.result === "matched");
  assert.equal(again.place.id, first.place.id);
  assert.equal(again.matched_by, "name_and_address");
  assert.deepEqual(again.filled, ["website", "google_place_id"]);
  const byGoogle = await upsertPlace(deps, place({ name: "Renamed on Google", google_place_id: "ChIJdishoom1", website: "https://other.example" }));
  assert.ok(byGoogle.ok && byGoogle.result === "matched");
  assert.equal(byGoogle.matched_by, "google_place_id");
  assert.deepEqual(byGoogle.filled, []);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 1);
  assert.equal((sqlite.prepare(`SELECT website FROM places`).get() as { website: string }).website, "https://dishoom.com/");

  // An older row with approximate coordinates matches on its street address instead.
  const old = addPlace(sqlite, { name: "Tayyabs", city: "london", lat: 51.5, lng: -0.12 });
  sqlite.prepare(`UPDATE places SET street_address = '83-89 Fieldgate St, London E1 1JU', address_locality = NULL WHERE id = ?`).run(old);
  const tayyabs = await upsertPlace(deps, place({ name: "Tayyabs", address: "83-89 Fieldgate St, London E1 1JU", lat: 51.5172, lng: -0.0635 }));
  assert.ok(tayyabs.ok && tayyabs.result === "matched");
  assert.equal(tayyabs.place.id, old);
  assert.equal(tayyabs.matched_by, "name_and_address");
  assert.deepEqual(tayyabs.filled, ["country", "city"]);
});

test("a chain's other branch nearby but not at the same spot is a new place", async () => {
  const { deps, sqlite } = setup();
  await upsertPlace(deps, place());
  const other = await upsertPlace(deps, place({ name: "Dishoom Shoreditch", address: "22 Kingly St, London W1B 5QP", lat: LONDON.lat + 0.0025, lng: LONDON.lng }));
  assert.ok(other.ok && other.result === "created");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 2);
});

test("upsert_place refuses alcohol-led and Ahmadiyya places with a reason", async () => {
  const { deps, sqlite } = setup();
  assert.deepEqual(await upsertPlace(deps, place({ name: "The Red Lion Pub" })), {
    ok: false,
    error: "rejected",
    rejected: "alcohol_led",
    reason: "Not listed: it looks like a pub, bar, brewery or wine bar.",
    message: "Not listed: it looks like a pub, bar, brewery or wine bar.",
  });
  const typed = await upsertPlace(deps, place({ name: "The Crown", google_types: ["bar", "pub"] }));
  assert.equal(!typed.ok && "rejected" in typed && typed.rejected, "alcohol_led");
  const ahmadiyya = await upsertPlace(deps, place({ name: "Baitul Futuh Langar Hall" }));
  assert.equal(!ahmadiyya.ok && "rejected" in ahmadiyya && ahmadiyya.rejected, "ahmadiyya");
  const described = await upsertPlace(deps, place({ name: "Community Kitchen", description: "Run by the Ahmadiyya Muslim Jamaat" }));
  assert.equal(!described.ok && "rejected" in described && described.rejected, "ahmadiyya");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 0);
});

test("upsert_place validates the city and website", async () => {
  const { deps } = setup();
  assert.equal((await upsertPlace(deps, place({ city: "!!!" }))).ok, false);
  const website = await upsertPlace(deps, place({ website: "http://dishoom.com" }));
  assert.equal(!website.ok && website.error, "invalid_website");
  const junk = await upsertPlace(deps, place({ website: "not a url" }));
  assert.equal(!junk.ok && junk.error, "invalid_website");
});

test("a batch never lists the same place twice", async () => {
  const { environment, sqlite } = mcpEnv();
  const out = await call(environment, "upsert_places", { places: [place(), place({ name: "Dishoom" }), place()] });
  assert.deepEqual(
    out.body.results.map((r: { result: string }) => r.result),
    ["created", "matched", "matched"],
  );
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 1);
});

/* --------------------------------------------------------- verifications */

async function creatorAndPlace() {
  const s = setup();
  await upsertCreator(s.deps, creator());
  const listed = await upsertPlace(s.deps, place());
  assert.ok(listed.ok);
  return { ...s, placeId: listed.place.id };
}

test("add_verification records the video once, adds it to the place's videos, and leaves halal status alone", async () => {
  const { deps, sqlite, placeId } = await creatorAndPlace();
  const statusBefore = sqlite.prepare(`SELECT * FROM place_status WHERE place_id = ?`).get(placeId);
  const first = await addVerification(deps, { creator: "@HalalFoodie", place_id: placeId, video_url: `https://www.youtube.com/watch?v=${VIDEO}&t=10s`, timestamp: 83, date: "2026-09-01", title: "Best breakfast in London?" });
  assert.ok(first.ok && first.result === "created");
  assert.deepEqual(
    { ...first.verification, id: "x" },
    {
      id: "x",
      creator: "halalfoodie",
      place_id: placeId,
      video_id: VIDEO,
      video_url: `https://www.youtube.com/watch?v=${VIDEO}&t=83s`,
      timestamp_seconds: 83,
      date: "2026-09-01",
      creator_url: `${ORIGIN}/u/halalfoodie`,
      place_url: `${ORIGIN}/place/${placeId}`,
    },
  );
  const link = sqlite.prepare(`SELECT * FROM place_media_links WHERE place_id = ?`).get(placeId) as Record<string, unknown>;
  assert.equal(link.url, `https://www.youtube.com/watch?v=${VIDEO}`);
  assert.equal(link.author_handle, "halalfoodie");
  assert.equal(link.author_name, "Halal Foodie");
  assert.equal(link.title, "Best breakfast in London?");
  assert.equal(link.submitted_by_user_id, null);
  assert.equal(link.thumbnail_url, `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`);
  assert.equal((sqlite.prepare(`SELECT media_link_id FROM creator_verifications`).get() as { media_link_id: string }).media_link_id, link.id);

  const repeat = await addVerification(deps, { creator: CHANNEL, place_id: placeId, video_url: `https://youtu.be/${VIDEO}` });
  assert.ok(repeat.ok && repeat.result === "matched");
  assert.equal(repeat.verification.id, first.verification.id);
  const moved = await addVerification(deps, { creator: CHANNEL, place_id: placeId, video_url: VIDEO, timestamp: "2:00" });
  assert.ok(moved.ok && moved.result === "updated");
  assert.equal(moved.verification.timestamp_seconds, 120);
  assert.equal(moved.verification.date, "2026-09-01");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_verifications"), 1);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_media_links"), 1);

  assert.deepEqual(sqlite.prepare(`SELECT * FROM place_status WHERE place_id = ?`).get(placeId), statusBefore);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM checks"), 0);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_signals"), 0);
});

test("add_verification explains what is wrong", async () => {
  const { deps, sqlite, placeId } = await creatorAndPlace();
  const base = { creator: "@halalfoodie", place_id: placeId, video_url: VIDEO };
  const error = async (input: Partial<typeof base> & Record<string, unknown>) => {
    const result = await addVerification(deps, { ...base, ...input } as typeof base);
    return result.ok ? "ok" : result.error;
  };
  assert.equal(await error({ place_id: "nope" }), "invalid_place_id");
  assert.equal(await error({ place_id: "3f2504e0-4f89-11d3-9a0c-999999999999" }), "place_not_found");
  assert.equal(await error({ video_url: "https://vimeo.com/1" }), "invalid_video_url");
  assert.equal(await error({ timestamp: "soon" }), "invalid_timestamp");
  assert.equal(await error({ date: "2030-01-01" }), "invalid_date");
  assert.equal(await error({ creator: "@nobody.here" }), "creator_not_found");
  assert.equal(await error({ creator: OTHER_CHANNEL }), "creator_not_found");
  assert.equal(await error({ creator: "@bad-handle" }), "creator_not_found");

  const hidden = addPlace(sqlite, { name: "Old Grill", status: "closed" });
  assert.equal(await error({ place_id: hidden }), "place_not_listed");
  const pub = addPlace(sqlite, { name: "The Red Lion Pub" });
  const rejected = await addVerification(deps, { ...base, place_id: pub });
  assert.ok(!rejected.ok && "rejected" in rejected && rejected.rejected === "alcohol_led");
  const mosque = addPlace(sqlite, { name: "Ahmadiyya Muslim Centre Canteen" });
  const ahmadiyya = await addVerification(deps, { ...base, place_id: mosque });
  assert.ok(!ahmadiyya.ok && "rejected" in ahmadiyya && ahmadiyya.rejected === "ahmadiyya");

  sqlite.prepare(`UPDATE creator_profiles SET claimed_at = 1`).run();
  assert.equal(await error({}), "creator_claimed");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_verifications"), 0);
});

test("remove_verification removes by id or by creator, place and video, and is idempotent", async () => {
  const { deps, sqlite, placeId } = await creatorAndPlace();
  const added = await addVerification(deps, { creator: "@halalfoodie", place_id: placeId, video_url: VIDEO });
  assert.ok(added.ok);
  assert.deepEqual(await removeVerification(deps, { creator: "@halalfoodie", place_id: placeId, video_url: `https://youtu.be/${VIDEO}` }), { ok: true, removed: true, id: added.verification.id });
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_media_links"), 0);
  assert.deepEqual(await removeVerification(deps, { id: added.verification.id }), { ok: true, removed: false, id: null });
  assert.deepEqual(await removeVerification(deps, { creator: "@nobody.here", place_id: placeId, video_url: VIDEO }), { ok: true, removed: false, id: null });
  assert.equal((await removeVerification(deps, { creator: "@halalfoodie", place_id: "x", video_url: VIDEO })).ok, false);
  assert.equal((await removeVerification(deps, { creator: "@halalfoodie", place_id: placeId, video_url: "x" })).ok, false);
});

test("a video a person linked first stays when the verification is removed", async () => {
  const { deps, sqlite, placeId } = await creatorAndPlace();
  addUser(sqlite, "diner");
  sqlite
    .prepare(`INSERT INTO place_media_links (id, place_id, submitted_by_user_id, platform, url, author_handle, created_at) VALUES ('human', ?, 'diner', 'youtube', ?, 'halalfoodie', 1)`)
    .run(placeId, `https://www.youtube.com/watch?v=${VIDEO}`);
  const added = await addVerification(deps, { creator: "@halalfoodie", place_id: placeId, video_url: VIDEO });
  assert.ok(added.ok && added.result === "created");
  assert.equal((sqlite.prepare(`SELECT media_link_id FROM creator_verifications`).get() as { media_link_id: string | null }).media_link_id, null);
  await removeVerification(deps, { id: added.verification.id });
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_media_links WHERE id = 'human'"), 1);
});

test("a claimed creator's verifications are theirs: Scout can't remove them", async () => {
  const { deps, sqlite, placeId } = await creatorAndPlace();
  const added = await addVerification(deps, { creator: "@halalfoodie", place_id: placeId, video_url: VIDEO });
  assert.ok(added.ok);
  sqlite.prepare(`UPDATE creator_profiles SET claimed_at = 1`).run();
  const out = await removeVerification(deps, { id: added.verification.id });
  assert.equal(!out.ok && out.error, "creator_claimed");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_verifications"), 1);
});

test("deleting a creator's account removes their creator rows and verifications", async () => {
  const { deps, sqlite, placeId } = await creatorAndPlace();
  await addVerification(deps, { creator: "@halalfoodie", place_id: placeId, video_url: VIDEO });
  sqlite.prepare(`DELETE FROM "user" WHERE email LIKE '%@unclaimed.invalid'`).run();
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_profiles"), 0);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM creator_verifications"), 0);
});

/* ------------------------------------------------------------ the route */

test("the route reads the secret, limiter, database and origin from the Worker", async () => {
  const { env } = await import("cloudflare:workers");
  const bindings = env as Record<string, unknown>;
  const { binding } = createTestDatabase();
  const keys: string[] = [];
  Object.assign(bindings, {
    DB: binding,
    MCP_ADMIN_SECRET: SECRET,
    MCP_WRITE_LIMITER: { async limit({ key }: { key: string }) { keys.push(key); return { success: true }; } },
  });
  try {
    const { POST, GET, DELETE } = await import("@/app/api/mcp/route");
    const { scoutEnvironment } = await import("./environment");
    const local = await scoutEnvironment(new Request("http://127.0.0.1:5173/api/mcp"));
    assert.equal((await local.deps()).origin, "http://127.0.0.1:5173");
    const response = await POST(
      new Request("http://127.0.0.1:5173/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "upsert_creator", arguments: creator() } }),
      }),
    );
    const text = await response.text();
    assert.match(text, /\\"result\\": \\"created\\"/);
    assert.match(text, /http:\/\/127\.0\.0\.1:5173\/u\/halalfoodie/);
    assert.equal(keys.length, 1);
    assert.equal(GET().status, 405);
    assert.equal(DELETE().status, 405);
    delete bindings.MCP_ADMIN_SECRET;
    const off = await POST(new Request("http://127.0.0.1:5173/api/mcp", { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: "{}" }));
    assert.equal(off.status, 503);
  } finally {
    for (const key of ["DB", "MCP_ADMIN_SECRET", "MCP_WRITE_LIMITER"]) delete bindings[key];
  }
});

/* ------------------------------------------------------- place attributes */

const HALAL_PAGE = "https://www.dishoom.com/halal";
const allFour = {
  halal_certified: { value: "yes", source_url: HALAL_PAGE, certifier_name: "HMC" },
  muslim_owned: { value: "yes", source_url: "https://www.dishoom.com/about" },
  no_pork: { value: "yes", source_url: "https://www.dishoom.com/menu" },
  no_alcohol: { value: "yes", source_url: "https://www.dishoom.com/menu" },
} as const;

type StatusRow = Record<string, string | number | null>;
const statusOf = (sqlite: ReturnType<typeof setup>["sqlite"], id: string) => sqlite.prepare(`SELECT * FROM place_status WHERE place_id = ?`).get(id) as StatusRow;

function addCheck(sqlite: ReturnType<typeof setup>["sqlite"], userId: string, placeId: string, answers: Partial<Record<"owned" | "certified" | "pork" | "alcohol", string | null>>) {
  addUser(sqlite, userId, userId, NOW - 30 * DAY);
  const { owned = null, certified = null, pork = null, alcohol = null } = answers;
  sqlite
    .prepare(`INSERT INTO checks (id, user_id, place_id, owned, certified, pork, alcohol, shared, excluded, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`)
    .run(crypto.randomUUID(), userId, placeId, owned, certified, pork, alcohol, crypto.randomUUID(), NOW - DAY);
}

test("upsert_place stores sourced attributes as web claims on create; they drive the filters but never the status", async () => {
  const { deps, sqlite } = setup();
  const result = await upsertPlace(deps, place(allFour));
  assert.ok(result.ok && result.result === "created");
  assert.deepEqual(result.attributes, { halal_certified: "set", muslim_owned: "set", no_pork: "set", no_alcohol: "set" });
  const status = statusOf(sqlite, result.place.id);
  assert.deepEqual(
    [status.status, status.owned_value, status.certified_value, status.pork_value, status.alcohol_value],
    ["unchecked", "yes", "yes", "no", "no"],
  );
  for (const fact of ["owned", "certified", "pork", "alcohol"]) {
    assert.equal(status[`${fact}_settled`], null, fact);
    assert.equal(status[`${fact}_sources`], "scout", fact);
  }
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_claims WHERE source = 'scout'"), 4);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_signals"), 0);

  const listed = await explorePlaces({ citySlug: "london", filters: ["owned", "certified", "no-pork", "no-alcohol"] }, deps.db);
  assert.deepEqual(listed.places.map((p) => p.id), [result.place.id]);
  assert.equal((await explorePlaces({ citySlug: "london", filters: ["verified"] }, deps.db)).total, 0);

  const detail = await getPlaceById(result.place.id, deps.db);
  assert.equal(detail?.evidence.certified, "Web source");
  assert.deepEqual(detail?.web_sources.certified, { url: HALAL_PAGE, certifier: "HMC" });
  assert.deepEqual(detail?.web_sources.pork, { url: "https://www.dishoom.com/menu", certifier: null });
});

test("unknown is no claim: it stays unknown, never no, and withdraws Scout's earlier claim", async () => {
  const { deps, sqlite } = setup();
  const created = await upsertPlace(deps, place({ muslim_owned: { value: "unknown" }, no_alcohol: { value: "no", source_url: "https://www.dishoom.com/drinks" } }));
  assert.ok(created.ok);
  assert.deepEqual(created.attributes, { muslim_owned: "unchanged", no_alcohol: "set" });
  let status = statusOf(sqlite, created.place.id);
  assert.equal(status.owned_value, null);
  assert.equal(status.alcohol_value, "yes");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_claims WHERE fact = 'owned'"), 0);
  // Serving alcohol is a fact about a restaurant, not a reason to refuse it.
  assert.equal(created.result, "created");

  const again = await upsertPlace(deps, place({ no_alcohol: { value: "unknown" } }));
  assert.ok(again.ok && again.result === "matched");
  assert.deepEqual(again.attributes, { no_alcohol: "cleared" });
  status = statusOf(sqlite, created.place.id);
  assert.equal(status.alcohol_value, null);
  assert.equal(status.alcohol_sources, "");
  const detail = await getPlaceById(created.place.id, deps.db);
  assert.equal(detail?.card.facts.alcohol, null);
  assert.deepEqual(detail?.web_sources, {});
});

test("a newer Scout write replaces Scout's older claim; the same claim again is unchanged", async () => {
  const { deps, sqlite } = setup();
  const first = await upsertPlace(deps, place({ no_pork: { value: "yes", source_url: "https://www.dishoom.com/menu" } }));
  assert.ok(first.ok);
  const same = await upsertPlace(deps, place({ no_pork: { value: "yes", source_url: "https://www.dishoom.com/menu" } }));
  assert.ok(same.ok && same.result === "matched");
  assert.deepEqual(same.attributes, { no_pork: "unchanged" });
  const flipped = await upsertPlace(deps, place({ no_pork: { value: "no", source_url: "https://www.dishoom.com/menu-2" } }));
  assert.ok(flipped.ok);
  assert.deepEqual(flipped.attributes, { no_pork: "updated" });
  assert.equal(statusOf(sqlite, first.place.id).pork_value, "yes");
  const row = sqlite.prepare(`SELECT value, source_url FROM place_claims WHERE place_id = ? AND fact = 'pork'`).get(first.place.id);
  assert.deepEqual({ ...(row as object) }, { value: "yes", source_url: "https://www.dishoom.com/menu-2" });
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_claims"), 1);
  // Attributes left out are left alone.
  const silent = await upsertPlace(deps, place());
  assert.ok(silent.ok);
  assert.deepEqual(silent.attributes, {});
  assert.equal(statusOf(sqlite, first.place.id).pork_value, "yes");
});

test("community checks and approved documents are never overridden; a map listing is", async () => {
  const { deps, sqlite } = setup();
  const id = addPlace(sqlite, { name: "Dishoom Shoreditch", city: "london", lat: LONDON.lat, lng: LONDON.lng });
  addCheck(sqlite, "u1", id, { owned: "no" });
  sqlite
    .prepare(`INSERT INTO place_signals (id, place_id, source, certified, review_status, reviewed_at, created_at, updated_at) VALUES (?, ?, 'certificate', 'no', 'approved', ?, ?, ?)`)
    .run(crypto.randomUUID(), id, NOW - DAY, NOW - DAY, NOW - DAY);
  sqlite
    .prepare(`INSERT INTO place_signals (id, place_id, source, provider, external_id, pork, listing_claim, review_status, created_at, updated_at) VALUES (?, ?, 'listing', 'osm', 'node/1', 'no', 'only', 'approved', ?, ?)`)
    .run(crypto.randomUUID(), id, NOW - DAY, NOW - DAY);
  await recomputePlaceStatus(id, deps.db, NOW);
  const before = statusOf(sqlite, id);
  assert.deepEqual([before.owned_value, before.certified_value, before.pork_value], ["no", "no", "no"]);

  const result = await upsertPlace(deps, place({ ...allFour, no_pork: { value: "no", source_url: "https://www.dishoom.com/menu" } }));
  assert.ok(result.ok && result.result === "matched");
  assert.equal(result.place.id, id);
  assert.deepEqual(result.attributes, { halal_certified: "kept_existing", muslim_owned: "kept_existing", no_pork: "set", no_alcohol: "set" });
  const after = statusOf(sqlite, id);
  assert.equal(after.owned_value, "no");
  assert.equal(after.owned_sources, "community");
  assert.equal(after.certified_value, "no");
  assert.equal(after.certified_settled, "no");
  assert.equal(after.pork_value, "yes");
  assert.equal(after.pork_sources, "scout");
  assert.equal(after.alcohol_value, "no");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_claims WHERE fact IN ('owned', 'certified')"), 0);
  // A Scout claim that was written before a person answered gives way to them.
  addCheck(sqlite, "u2", id, { alcohol: "yes" });
  await recomputePlaceStatus(id, deps.db, NOW);
  assert.equal(statusOf(sqlite, id).alcohol_value, "yes");
  assert.equal((await getPlaceById(id, deps.db))?.web_sources.alcohol, undefined);
});

test("Scout claims never move a status up: unchecked stays unchecked, n of 3 stays n of 3", async () => {
  const { deps, sqlite } = setup();
  const id = addPlace(sqlite, { name: "Dishoom Shoreditch", city: "london", lat: LONDON.lat, lng: LONDON.lng });
  const all = { owned: "yes", certified: "yes", pork: "no", alcohol: "no" };
  addCheck(sqlite, "a", id, all);
  addCheck(sqlite, "b", id, all);
  await recomputePlaceStatus(id, deps.db, NOW);
  const before = statusOf(sqlite, id);
  assert.deepEqual([before.status, before.progress], ["checking", 2]);
  const result = await upsertPlace(deps, place(allFour));
  assert.ok(result.ok);
  assert.deepEqual(result.attributes, { halal_certified: "kept_existing", muslim_owned: "kept_existing", no_pork: "kept_existing", no_alcohol: "kept_existing" });
  assert.deepEqual(statusOf(sqlite, id), before);

  // Even claims on every fact of an unanswered place leave it Not checked yet, with nothing settled.
  const other = await upsertPlace(deps, place({ name: "Tayyabs", address: "83-89 Fieldgate St, London E1 1JU", lat: 51.5172, lng: -0.0635, ...allFour }));
  assert.ok(other.ok && other.result === "created");
  const status = statusOf(sqlite, other.place.id);
  assert.deepEqual([status.status, status.progress, status.eligible_checks, status.verified_at], ["unchecked", 0, 0, null]);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_status_changes WHERE place_id = ?", other.place.id), 0);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM points"), 0);
});

test("attribute inputs are validated: https sources, a source for yes/no, a certifier only with yes", async () => {
  const { environment, sqlite } = mcpEnv();
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ halal_certified: { value: "yes", source_url: "http://example.com" } }, /https URLs/],
    [{ no_pork: { value: "yes" } }, /needs a source_url/],
    [{ halal_certified: { value: "no", source_url: HALAL_PAGE, certifier_name: "HMC" } }, /certifier_name only goes with value yes/],
    [{ muslim_owned: { value: "maybe", source_url: HALAL_PAGE } }, /muslim_owned/],
  ];
  for (const [attributes, message] of cases) {
    const out = await call(environment, "upsert_place", place(attributes as Partial<UpsertPlaceInput>));
    assert.equal(out.isError, true, JSON.stringify(attributes));
    assert.match(out.text, message);
  }
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 0);
  const ok = await call(environment, "upsert_places", { places: [place(allFour)] });
  assert.deepEqual(ok.body.results[0].attributes, { halal_certified: "set", muslim_owned: "set", no_pork: "set", no_alcohol: "set" });
  // An alcohol-led place is still refused, whatever its attributes say.
  const bar = await call(environment, "upsert_place", place({ name: "The Kings Arms Pub", no_alcohol: { value: "yes", source_url: HALAL_PAGE } }));
  assert.equal(bar.body.error, "rejected");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM place_claims"), 4);
});

test("the seed's Scout-claimed places carry the status recomputePlaceStatus gives them", async () => {
  const { deps, sqlite } = setup();
  sqlite.exec(readFileSync(join(import.meta.dirname, "../../seed/local.sql"), "utf8"));
  const columns = "status, progress, owned_value, certified_value, pork_value, alcohol_value, owned_settled, certified_settled, pork_settled, alcohol_settled, owned_sources, certified_sources, pork_sources, alcohol_sources";
  for (const id of ["00000000-0000-4000-8000-000000000007", "00000000-0000-4000-8000-000000000008"]) {
    const seeded = { ...(sqlite.prepare(`SELECT ${columns} FROM place_status WHERE place_id = ?`).get(id) as object) };
    await recomputePlaceStatus(id, deps.db, NOW);
    assert.deepEqual({ ...(sqlite.prepare(`SELECT ${columns} FROM place_status WHERE place_id = ?`).get(id) as object) }, seeded, id);
  }
});

/* ------------------------------------------------ coordinates and force_new */

const noCoords = (over: Partial<UpsertPlaceInput> = {}): UpsertPlaceInput => {
  const { lat: _lat, lng: _lng, ...rest } = place(over);
  return { ...rest, ...over };
};

function googleDeps(s: ReturnType<typeof setup>, respond: (init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    return respond(init);
  });
  return { deps: { ...s.deps, google: { apiKey: "test-key", searchCap: 10, detailsCap: 10 } } satisfies ScoutDeps, calls };
}
const googleJson = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const DISHOOM_RESULT = { places: [{ types: ["establishment"], id: "ChIJdishoom1", displayName: { text: "Dishoom" }, formattedAddress: "7 Boundary St, London E2 7JE, UK", location: { latitude: 51.5245, longitude: -0.0768 } }] };

test("without lat/lng and without a Google key, a place is listed with no coordinates, never guessed ones", async () => {
  const { deps, sqlite } = setup();
  const result = await upsertPlace(deps, noCoords());
  assert.ok(result.ok && result.result === "created");
  assert.equal(result.location, "null");
  assert.equal(result.geocode, "not_configured");
  const row = sqlite.prepare(`SELECT lat, lng, maps_url, listing_status FROM places WHERE id = ?`).get(result.place.id) as Record<string, unknown>;
  assert.deepEqual([row.lat, row.lng, row.listing_status], [null, null, "listed"]);
  assert.match(String(row.maps_url), /query=Dishoom%20Shoreditch%2C%207%20Boundary%20St/);
  // Still on its city page, in search and on the place page; never on the map or among nearby places.
  assert.deepEqual((await explorePlaces({ citySlug: "london" }, deps.db)).places.map((p) => p.id), [result.place.id]);
  assert.deepEqual((await searchPlaces("dishoom", {}, deps.db)).map((p) => p.id), [result.place.id]);
  assert.equal((await explorePlaces({ bbox: { west: -1, south: 51, east: 1, north: 52 } }, deps.db)).total, 0);
  const near = await explorePlaces({ citySlug: "london", near: LONDON }, deps.db);
  assert.equal(near.places[0]?.distanceKm, null);
  const detail = await getPlaceById(result.place.id, deps.db);
  assert.deepEqual([detail?.lat, detail?.lng], [null, null]);

  // Matching without coordinates falls back to the city and street address.
  const again = await upsertPlace(deps, noCoords({ name: "Dishoom" }));
  assert.ok(again.ok && again.result === "matched");
  assert.equal(again.matched_by, "name_and_address");
  assert.equal(again.location, "null");
  // Sending coordinates later fills the blank.
  const later = await upsertPlace(deps, place());
  assert.ok(later.ok && later.result === "matched");
  assert.equal(later.location, "provided");
  assert.ok(later.filled.includes("lat"));
  assert.equal(later.place.lat, LONDON.lat);
  const kept = await upsertPlace(deps, noCoords());
  assert.ok(kept.ok && kept.result === "matched");
  assert.equal(kept.location, "existing");
});

test("without lat/lng, a confident geocode sets the coordinates; a low-confidence one leaves them empty", async () => {
  const s = setup();
  const good = googleDeps(s, () => googleJson(DISHOOM_RESULT));
  const created = await upsertPlace(good.deps, noCoords());
  assert.ok(created.ok && created.result === "created");
  assert.equal(created.location, "geocoded");
  assert.deepEqual([created.place.lat, created.place.lng], [51.5245, -0.0768]);
  assert.equal(good.calls.length, 1);
  // Sent coordinates are used as they are, without a Google call.
  const provided = await upsertPlace(good.deps, place({ name: "Tayyabs", address: "83-89 Fieldgate St, London E1 1JU", lat: 51.5172, lng: -0.0635 }));
  assert.ok(provided.ok && provided.location === "provided");
  assert.equal(good.calls.length, 1);

  const wrong = googleDeps(s, () => googleJson({ places: [{ ...DISHOOM_RESULT.places[0], formattedAddress: "7 Boundary Rd, Portsmouth PO6 1AB, UK", location: { latitude: 50.84, longitude: -1.07 } }] }));
  const lost = await upsertPlace(wrong.deps, noCoords({ name: "Lahore Kebab House", address: "2-10 Umberston St, London E1 1PY" }));
  assert.ok(lost.ok && lost.result === "created");
  assert.deepEqual([lost.location, lost.geocode, lost.place.lat], ["null", "wrong_city", null]);

  // A matched place with no coordinates is geocoded once to fill them.
  const old = addPlace(s.sqlite, { name: "Needoo Grill", city: "london", lat: null, lng: null });
  s.sqlite.prepare(`UPDATE places SET street_address = '87 New Rd, London E1 1HH' WHERE id = ?`).run(old);
  const fill = googleDeps(s, () => googleJson({ places: [{ ...DISHOOM_RESULT.places[0], formattedAddress: "87 New Rd, London E1 1HH, UK", location: { latitude: 51.5166, longitude: -0.0647 } }] }));
  const matched = await upsertPlace(fill.deps, noCoords({ name: "Needoo Grill", address: "87 New Rd, London E1 1HH" }));
  assert.ok(matched.ok && matched.result === "matched");
  assert.equal(matched.place.id, old);
  assert.equal(matched.location, "geocoded");
  assert.deepEqual(matched.filled.filter((f) => f === "lat" || f === "lng"), ["lat", "lng"]);
  vi.unstubAllGlobals();
});

test("lat without lng is refused at the boundary", async () => {
  const { environment } = mcpEnv();
  const out = await call(environment, "upsert_place", { ...noCoords(), lat: 51.5 });
  assert.equal(out.isError, true);
  assert.match(out.text, /lat and lng together/);
  const ok = await call(environment, "upsert_place", noCoords());
  assert.equal(ok.body.location, "null");
});

test("force_new lists a stall at its food hall's address instead of matching the hall", async () => {
  const { deps, sqlite } = setup();
  const hall = await upsertPlace(deps, place({ name: "Kingsbridge Food Hall", address: "1 Kingsbridge Rd, London" }));
  assert.ok(hall.ok && hall.result === "created");
  // Without force_new a near-identical name at the same spot matches, as it should for the same venue.
  const same = await upsertPlace(deps, place({ name: "Kingsbridge Food Hall London", address: "1 Kingsbridge Rd, London" }));
  assert.ok(same.ok && same.result === "matched");
  // The stall named after its host no longer matches it, even without force_new (the Oklahoma Burgers case).
  const stall = await upsertPlace(deps, place({ name: "Oklahoma Burgers - Kingsbridge Food Hall", address: "1 Kingsbridge Rd, London" }));
  assert.ok(stall.ok && stall.result === "created");
  const forced = await upsertPlace(deps, place({ name: "Kingsbridge Food Hall Grill", address: "1 Kingsbridge Rd, London", force_new: true }));
  assert.ok(forced.ok && forced.result === "created");
  assert.notEqual(forced.place.id, hall.place.id);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 3);

  // force_new can't duplicate a row: same city, name and street, or the same Google id.
  const twin = await upsertPlace(deps, place({ name: "Kingsbridge Food Hall", address: "1 Kingsbridge Rd, London", force_new: true }));
  assert.deepEqual(twin.ok ? null : { error: twin.error, id: (twin as { existing_place_id?: string }).existing_place_id }, { error: "duplicate_place", id: hall.place.id });
  const google = await upsertPlace(deps, place({ name: "Burger Stall", address: "1 Kingsbridge Rd, London", google_place_id: "ChIJhall00001" }));
  assert.ok(google.ok);
  const googleTwin = await upsertPlace(deps, place({ name: "Another name", address: "9 Elsewhere St, London", google_place_id: "ChIJhall00001", force_new: true }));
  assert.equal(googleTwin.ok, false);
  assert.equal((googleTwin as { error: string }).error, "duplicate_place");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 4);
});

test("force_new is per item in a batch", async () => {
  const { environment, sqlite } = mcpEnv();
  const out = await call(environment, "upsert_places", {
    places: [place({ name: "Kingsbridge Food Hall" }), place({ name: "Kingsbridge Food Hall", force_new: true }), place({ name: "Kingsbridge Food Hall" })],
  });
  assert.deepEqual(out.body.results.map((r: { result?: string; error?: string }) => r.result ?? r.error), ["created", "duplicate_place", "matched"]);
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 1);
});

test("city-only MCP input leaves location pending", async () => {
  const { environment, sqlite } = mcpEnv();
  const out = await call(environment, "upsert_place", noCoords({ address: "London, United Kingdom" }));
  assert.equal(out.body.location, "null");
  assert.equal(out.body.geocode, "no_street_address");
  assert.equal((sqlite.prepare("SELECT location_source FROM places").get() as { location_source: unknown }).location_source, null);
});

test("Scout sources relocate with a street address or explicit coordinates and keep city identity", async () => {
  for (const source of ["scout", "geocoded"]) {
    const s = setup();
    const created = await upsertPlace(s.deps, place({ google_place_id: "ChIJdishoom1" }));
    assert.ok(created.ok);
    s.sqlite.prepare("UPDATE places SET location_source = ?, street_address = 'London', city_slug = 'greater-london' WHERE id = ?").run(source, created.place.id);
    const good = googleDeps(s, () => googleJson(DISHOOM_RESULT.places[0]));
    const result = await call({ secret: SECRET, deps: async () => good.deps }, "upsert_place", noCoords({ google_place_id: "ChIJdishoom1" }));
    assert.equal(result.body.location, "relocated");
    assert.deepEqual(result.body.previous, { ...LONDON, source });
    assert.deepEqual(result.body.current, { lat: 51.5245, lng: -0.0768, source: "geocoded" });
    const row = s.sqlite.prepare("SELECT * FROM places WHERE id = ?").get(created.place.id) as Record<string, unknown>;
    assert.equal(row.city_slug, "greater-london");
    assert.equal(row.street_address, place().address);
    assert.equal(row.location_source, "geocoded");
    assert.ok(count(s.sqlite, "SELECT count(*) AS n FROM audit_log WHERE actor_user_id = 'mcp:scout'") >= 2);
    const forced = await upsertPlace(good.deps, place({ address: "London", google_place_id: "ChIJdishoom1", relocate: true }));
    assert.ok(forced.ok);
    assert.equal(forced.location, "relocated");
    assert.equal(forced.current?.source, "scout");
    vi.unstubAllGlobals();
  }
});

test("protected sources refuse relocation; a Scout creation audit is required for legacy unknown sources", async () => {
  for (const source of ["community", "google", "import", "listing", null]) {
    const s = setup();
    const id = addPlace(s.sqlite, { name: place().name, city: "london", googlePlaceId: "ChIJdishoom1" });
    s.sqlite.prepare("UPDATE places SET location_source = ? WHERE id = ?").run(source, id);
    for (const relocate of [false, true]) {
      const out = await call({ secret: SECRET, deps: async () => s.deps }, "upsert_place", place({ google_place_id: "ChIJdishoom1", relocate }));
      assert.equal(out.body.location, "existing");
      assert.equal(out.body.relocate_refused, "protected_source");
      assert.equal((out.body.place as { lat: number }).lat, 19.06);
    }
  }
  const s = setup();
  const created = await upsertPlace(s.deps, place({ google_place_id: "ChIJdishoom1" }));
  assert.ok(created.ok);
  s.sqlite.prepare("UPDATE places SET location_source = NULL WHERE id = ?").run(created.place.id);
  const refused = await upsertPlace(s.deps, place({ google_place_id: "ChIJdishoom1" }));
  assert.ok(refused.ok && refused.location === "existing");
  const forced = await upsertPlace(s.deps, place({ google_place_id: "ChIJdishoom1", relocate: true }));
  assert.ok(forced.ok && forced.location === "relocated");
  assert.equal(forced.previous?.source, null);
});

test("location sources describe explicit and geocoded creation", async () => {
  const s = setup();
  const first = await upsertPlace(s.deps, place());
  assert.ok(first.ok);
  assert.equal((s.sqlite.prepare("SELECT location_source FROM places WHERE id = ?").get(first.place.id) as { location_source: string }).location_source, "scout");
  const good = googleDeps(s, () => googleJson(DISHOOM_RESULT));
  const second = await upsertPlace(good.deps, noCoords({ force_new: true, name: "Another Cafe" }));
  assert.ok(second.ok);
  assert.equal((s.sqlite.prepare("SELECT location_source FROM places WHERE id = ?").get(second.place.id) as { location_source: string }).location_source, "geocoded");
  vi.unstubAllGlobals();
});

test("explicit relocation targets a legacy city pin by id without weakening chain matching", async () => {
  const s = setup();
  const first = await upsertPlace(s.deps, noCoords({ address: "London" }));
  assert.ok(first.ok);
  const out = await call({ secret: SECRET, deps: async () => s.deps }, "upsert_places", { places: [place({ place_id: first.place.id, relocate: true })] });
  const results = out.body.results as { location: string; place: { id: string } }[];
  assert.equal(results[0]?.location, "provided");
  assert.equal(results[0]?.place.id, first.place.id);
  assert.equal(count(s.sqlite, "SELECT count(*) AS n FROM places"), 1);
});

test("forced relocation still requires trusted coordinates and refreshes coordinate Directions", async () => {
  const s = setup();
  const created = await upsertPlace(s.deps, place());
  assert.ok(created.ok);
  const street = googleDeps(s, () => googleJson(DISHOOM_RESULT));
  const ordinary = await upsertPlace(street.deps, noCoords());
  assert.ok(ordinary.ok && ordinary.location === "existing");
  assert.equal(ordinary.relocate_refused, "not_more_precise");
  const forced = await upsertPlace(street.deps, noCoords({ place_id: created.place.id, relocate: true }));
  assert.ok(forced.ok && forced.location === "relocated");
  const maps = (s.sqlite.prepare("SELECT maps_url FROM places WHERE id = ?").get(created.place.id) as { maps_url: string }).maps_url;
  assert.ok(maps.includes("51.5245,-0.0768") || maps.includes("51.5245%2C-0.0768"));
  const city = await upsertPlace(street.deps, noCoords({ address: "London", place_id: created.place.id, relocate: true }));
  assert.ok(city.ok && city.location === "existing");
  assert.equal(city.relocate_refused, "no_street_address");
  const bad = googleDeps(s, () => googleJson({ places: [{ ...DISHOOM_RESULT.places[0], types: ["locality"] }] }));
  const refused = await upsertPlace(bad.deps, noCoords({ place_id: created.place.id, relocate: true }));
  assert.ok(refused.ok && refused.location === "existing");
  assert.equal(refused.geocode, "not_street_level");
  assert.equal(refused.place.lat, 51.5245);
  vi.unstubAllGlobals();
});

test("a concurrent protected location change wins over in-flight geocoding", async () => {
  const s = setup();
  const first = await upsertPlace(s.deps, place());
  assert.ok(first.ok);
  const google = googleDeps(s, () => {
    s.sqlite.prepare("UPDATE places SET lat = 51.6, location_source = 'community' WHERE id = ?").run(first.place.id);
    return googleJson(DISHOOM_RESULT);
  });
  const out = await upsertPlace(google.deps, noCoords({ place_id: first.place.id, relocate: true }));
  assert.ok(out.ok && out.location === "existing");
  assert.equal(out.relocate_refused, "location_changed");
  assert.equal(out.place.lat, 51.6);
  vi.unstubAllGlobals();
});

test("repair ids are validated and never create a replacement row", async () => {
  const { environment, sqlite } = mcpEnv();
  for (const input of [place({ place_id: "invalid", relocate: true }), place({ place_id: crypto.randomUUID() }), place({ place_id: crypto.randomUUID(), relocate: true, force_new: true })]) {
    assert.equal((await call(environment, "upsert_place", input)).isError, true);
  }
  const out = await call(environment, "upsert_place", place({ place_id: crypto.randomUUID(), relocate: true }));
  assert.equal(out.body.error, "place_not_found");
  assert.equal(count(sqlite, "SELECT count(*) AS n FROM places"), 0);
});

test("partial protected coordinate pairs keep their existing coordinate and source", async () => {
  for (const source of ["community", "google", "import", "listing", null]) {
    const s = setup();
    const id = addPlace(s.sqlite, { lat: null, googlePlaceId: "ChIJdishoom1" });
    s.sqlite.prepare("UPDATE places SET location_source = ? WHERE id = ?").run(source, id);
    const out = await upsertPlace(s.deps, place({ place_id: id, relocate: true }));
    assert.ok(out.ok && out.location === "existing");
    assert.equal(out.relocate_refused, "protected_source");
    assert.deepEqual({ ...s.sqlite.prepare("SELECT lat, lng, location_source FROM places WHERE id = ?").get(id) }, { lat: null, lng: 72.83, location_source: source });
  }
});

const component = (longText: string, shortText: string, type: string) => ({ longText, shortText, types: [type, "political"] });
const CITY_MATCH_CASES = [
  { name: "Chachu's", city: "Toronto", country: "Canada", address: "16-747 Don Mills Rd, North York, ON M3C 1T2, Canada", lat: 43.71, lng: -79.333,
    components: [component("North York", "North York", "sublocality_level_1"), component("Ontario", "ON", "administrative_area_level_1"), component("Canada", "CA", "country")] },
  { name: "Yaki Ya Edgware", city: "London", country: "GB", address: "25 Station Rd, Edgware HA8 7AB, UK", lat: 51.611, lng: -0.275,
    components: [component("Edgware", "Edgware", "postal_town"), component("Greater London", "Greater London", "administrative_area_level_2"), component("United Kingdom", "GB", "country")] },
  { name: "GYUMON Shibuya", city: "Tokyo", country: "Japan", address: "Japan, 〒150-0043 Tokyo, Shibuya City, Dogenzaka, 2 Chome−29−8", lat: 35.659, lng: 139.698,
    components: [component("Shibuya City", "Shibuya", "locality"), component("Tokyo", "Tokyo", "administrative_area_level_1"), component("Japan", "JP", "country")] },
  { name: "PANGA Asakusa", city: "Tokyo", country: "JP", address: "日本、〒111-0032 東京都台東区浅草１丁目", lat: 35.712, lng: 139.794,
    components: [component("台東区", "台東区", "locality"), component("東京都", "東京都", "administrative_area_level_1"), component("日本", "JP", "country")] },
];

for (const venue of CITY_MATCH_CASES) {
  for (const details of [false, true]) test(`trusts ${venue.name} via ${details ? "Details" : "Text Search"} structured address`, async () => {
    const s = setup();
    const response = { id: "ChIJcitymatch1", displayName: { text: venue.name }, types: ["restaurant", "food", "point_of_interest", "establishment"],
      location: { latitude: venue.lat, longitude: venue.lng }, formattedAddress: venue.address, addressComponents: venue.components };
    let mask = "";
    const google = googleDeps(s, (init) => {
      mask = new Headers(init?.headers).get("X-Goog-FieldMask") ?? "";
      return googleJson(details ? response : { places: [response] });
    });
    try {
      const out = await call({ secret: SECRET, deps: async () => google.deps }, "upsert_place", noCoords({ name: venue.name, address: venue.name === "PANGA Asakusa" ? "1 Chome Asakusa, Taito City, Tokyo" : venue.address, city: venue.city, country: venue.country, ...(details ? { google_place_id: response.id } : {}) }));
      assert.equal(out.body.location, "geocoded", out.body.geocode);
      assert.ok(mask.split(",").includes(details ? "addressComponents" : "places.addressComponents"));
      assert.deepEqual([out.body.place.lat, out.body.place.lng], [venue.lat, venue.lng]);
    } finally { vi.unstubAllGlobals(); }
  });
}

for (const wrongCountry of [false, true]) test(`structured geocode rejects a true wrong ${wrongCountry ? "country" : "city"}`, async () => {
  const s = setup();
  const response = { id: "ChIJwrongcity1", displayName: { text: "Example Cafe" }, types: ["restaurant"],
    location: { latitude: wrongCountry ? 42.98 : 53.48, longitude: wrongCountry ? -81.24 : -2.24 },
    formattedAddress: wrongCountry ? "7 Boundary St, London, ON, Canada" : "7 Boundary St, Manchester, UK",
    addressComponents: [component(wrongCountry ? "London" : "Manchester", wrongCountry ? "London" : "Manchester", "locality"), component(wrongCountry ? "Canada" : "United Kingdom", wrongCountry ? "CA" : "GB", "country")] };
  const google = googleDeps(s, () => googleJson({ places: [response] }));
  try {
    const out = await call({ secret: SECRET, deps: async () => google.deps }, "upsert_place", noCoords());
    assert.equal(out.body.geocode, wrongCountry ? "wrong_country" : "wrong_city");
    assert.equal(out.body.place.lat, null);
  } finally { vi.unstubAllGlobals(); }
});

for (const source of ["scout", "geocoded", "google", "import", "community", "listing", null]) {
  for (const missing of [false, true]) test(`failed geocode address repair: source ${source}, missing coordinates ${missing}`, async () => {
    const s = setup();
    const created = await upsertPlace(s.deps, place({ address: "London" }));
    assert.ok(created.ok);
    s.sqlite.prepare("UPDATE places SET location_source = ?, lat = ?, lng = ? WHERE id = ?").run(source, missing ? null : LONDON.lat, missing ? null : LONDON.lng, created.place.id);
    if (source === null) s.sqlite.prepare("DELETE FROM audit_log").run();
    const google = googleDeps(s, () => googleJson({ places: [] }));
    try {
      const out = await call({ secret: SECRET, deps: async () => google.deps }, "upsert_place", noCoords({ place_id: created.place.id, relocate: true }));
      const allowed = source === "scout" || source === "geocoded" || (missing && source === null);
      assert.equal(out.body.place.address, allowed ? place().address : "London");
      assert.deepEqual([out.body.place.lat, out.body.place.lng], missing ? [null, null] : [LONDON.lat, LONDON.lng]);
      if (allowed) {
        assert.equal(out.body.address_updated, true);
        assert.deepEqual(out.body.address_change, { previous: "London", current: place().address });
        assert.ok(out.body.filled.includes("street_address"));
        if (missing) assert.ok(String((s.sqlite.prepare("SELECT maps_url FROM places WHERE id = ?").get(created.place.id) as { maps_url: string }).maps_url).includes(encodeURIComponent(place().address)));
      }
    } finally { vi.unstubAllGlobals(); }
  });
}

test("address repair collision returns a refusal without changing either place", async () => {
  const s = setup();
  const first = await upsertPlace(s.deps, place({ address: "London" }));
  const second = await upsertPlace(s.deps, place({ force_new: true }));
  assert.ok(first.ok && second.ok);
  const google = googleDeps(s, () => googleJson({ places: [] }));
  try {
    const out = await call({ secret: SECRET, deps: async () => google.deps }, "upsert_place", noCoords({ place_id: first.place.id, relocate: true }));
    assert.equal(out.isError, false);
    assert.equal(out.body.address_refused, "duplicate_place");
    assert.equal(out.body.place.address, "London");
    assert.equal(count(s.sqlite, "SELECT count(*) AS n FROM places"), 2);
  } finally { vi.unstubAllGlobals(); }
});

test("a failed geocode repairs a legacy Scout address with creation proof and publishes a cache version", async () => {
  const s = setup();
  const first = await upsertPlace(s.deps, place({ address: "London" }));
  assert.ok(first.ok);
  s.sqlite.prepare("UPDATE places SET location_source = NULL WHERE id = ?").run(first.place.id);
  const before = count(s.sqlite, "SELECT count(*) AS n FROM audit_log WHERE action = 'listing.changed'");
  const google = googleDeps(s, () => googleJson({ places: [{ ...DISHOOM_RESULT.places[0], types: ["locality"] }] }));
  try {
    const out = await call({ secret: SECRET, deps: async () => google.deps }, "upsert_place", noCoords({ place_id: first.place.id, relocate: true }));
    assert.equal(out.body.geocode, "not_street_level");
    assert.equal(out.body.address_updated, true);
    assert.equal(out.body.place.address, place().address);
    assert.deepEqual([out.body.place.lat, out.body.place.lng], [LONDON.lat, LONDON.lng]);
    assert.equal(count(s.sqlite, "SELECT count(*) AS n FROM audit_log WHERE action = 'listing.changed'"), before + 1);
  } finally { vi.unstubAllGlobals(); }
});

test("a concurrent protected edit wins even when geocoding fails", async () => {
  const s = setup();
  const first = await upsertPlace(s.deps, place({ address: "London" }));
  assert.ok(first.ok);
  const google = googleDeps(s, () => {
    s.sqlite.prepare("UPDATE places SET street_address = '9 Community Road', location_source = 'community' WHERE id = ?").run(first.place.id);
    return googleJson({ places: [] });
  });
  try {
    const out = await call({ secret: SECRET, deps: async () => google.deps }, "upsert_place", noCoords({ place_id: first.place.id, relocate: true }));
    assert.equal(out.body.address_refused, "location_changed");
    assert.equal(out.body.place.address, "9 Community Road");
  } finally { vi.unstubAllGlobals(); }
});

test("address collision also stays safe when relocation obtains trusted coordinates", async () => {
  const s = setup();
  const first = await upsertPlace(s.deps, place({ address: "London" }));
  const second = await upsertPlace(s.deps, place({ force_new: true }));
  assert.ok(first.ok && second.ok);
  const google = googleDeps(s, () => googleJson(DISHOOM_RESULT));
  try {
    const out = await call({ secret: SECRET, deps: async () => google.deps }, "upsert_place", noCoords({ place_id: first.place.id, relocate: true }));
    assert.equal(out.isError, false);
    assert.equal(out.body.address_refused, "duplicate_place");
    assert.equal(out.body.place.address, "London");
    assert.equal(out.body.location, "relocated");
  } finally { vi.unstubAllGlobals(); }
});
