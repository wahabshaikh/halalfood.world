import assert from "node:assert/strict";
import { test } from "vitest";
import { addPlace, addProfile, addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";
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
