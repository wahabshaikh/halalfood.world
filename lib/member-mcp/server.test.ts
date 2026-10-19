import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { POST, GET, DELETE } from "@/app/api/mcp/member/route";
import { env } from "@/lib/testing/cloudflare-workers";
import { addPlace, addUser, addProfile, DAY, createTestDatabase } from "@/lib/testing/sqlite-d1";
import { createMemberKey, revokeMemberKey } from "@/lib/member-keys";
import { consumeVouchLimits } from "@/lib/otp-rate-limit";
import { handleMemberRequest, MAX_BODY_BYTES } from "./server";

const URL = "https://halalfood.world/api/mcp/member";
const databases: ReturnType<typeof createTestDatabase>[] = [];

function setup() {
  const db = createTestDatabase();
  databases.push(db);
  env.DB = db.binding;
  return db;
}

afterEach(() => {
  vi.useRealTimers();
  delete env.MEMBER_MCP_WRITE_LIMITER;
  delete env.MEMBER_MCP_READ_LIMITER;
  delete env.DB;
  for (const db of databases.splice(0)) db.sqlite.close();
});

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(URL, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

type RpcBody = {
  result?: {
    tools?: { name: string; annotations?: { readOnlyHint: boolean }; inputSchema: { properties: { limit: { maximum: number; default: number } } } }[];
    serverInfo?: { name: string };
    instructions?: string;
    content?: { text: string }[];
    isError?: boolean;
  };
  error?: { message: string };
};

async function rpc(method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  const response = await POST(request({ jsonrpc: "2.0", id: 1, method, params }, headers));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data ? data.slice(6) : text) as RpcBody;
}

async function call(name: string, args: unknown, headers: Record<string, string> = {}) {
  const body = await rpc("tools/call", { name, arguments: args }, headers);
  const text = body.result?.content?.[0]?.text;
  return { body, value: text?.startsWith("{") ? JSON.parse(text) : null };
}

test("initialize and tools/list are public without an admin token or a database", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result?.serverInfo?.name, "halalfood-world");
  assert.match(init.result!.instructions!, /Anonymous tools are read-only/);
  assert.match(init.result!.instructions!, /community checks and reviewed documents/);
  assert.match(init.result!.instructions!, /must not be scraped in bulk/);
  const tools = (await rpc("tools/list")).result!.tools!;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["get_place", "search_places"]);
  assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint));
  const limit = tools.find((tool) => tool.name === "search_places")!.inputSchema.properties.limit;
  assert.equal(limit.maximum, 10);
  assert.equal(limit.default, 10);
});

test("search is capped at ten, accepts smaller limits, and rejects out-of-range inputs", async () => {
  const { sqlite } = setup();
  for (let i = 0; i < 12; i++) addPlace(sqlite, { name: `Cafe ${i}` });
  addPlace(sqlite, { name: "Cafe hidden", status: "hidden" });
  for (const args of [{ q: "Cafe" }, { q: "Cafe", limit: 10 }]) {
    const out = await call("search_places", args);
    assert.equal(out.value.places.length, 10);
    assert.equal(out.body.result?.isError, undefined);
  }
  assert.equal((await call("search_places", { q: "Cafe", limit: 2 })).value.places.length, 2);
  for (const args of [{ q: "Cafe", limit: 11 }, { q: "Cafe", limit: 0 }, { q: "Cafe", limit: 1.5 }, { q: " " }, { q: "x".repeat(65) }, { q: "Cafe", city: "bad/slug" }]) {
    const { body } = await call("search_places", args);
    assert.ok(body.result?.isError || body.error);
  }
});

test("both tools expose only public fields, reuse city ranking, and omit unlisted places", async () => {
  const { sqlite } = setup();
  const london = addPlace(sqlite, { name: "Cafe A", city: "london" });
  const id = addPlace(sqlite, { name: "Cafe Z", city: "mumbai" });
  const hidden = addPlace(sqlite, { name: "Cafe hidden", status: "hidden" });
  const closed = addPlace(sqlite, { name: "Cafe closed", status: "closed" });
  sqlite.prepare("UPDATE places SET google_details_snapshot = ? WHERE id = ?").run('{"email":"private@example.com"}', id);
  sqlite.prepare("UPDATE place_status SET owned_value = 'yes', pork_value = 'no' WHERE place_id = ?").run(id);
  const search = await call("search_places", { q: "Cafe", city: "mumbai" });
  assert.deepEqual(search.value.places.map((place: { id: string }) => place.id), [id, london]);
  const detail = await call("get_place", { id });
  assert.deepEqual(detail.value.place, search.value.places[0]);
  assert.deepEqual(detail.value.place, {
    id, name: "Cafe Z", city: "mumbai", area: "Bandra West", cuisine: "Mughlai",
    status: { kind: "unchecked" },
    facts: { owned: "yes", certified: null, pork: "no", alcohol: null },
    url: `https://halalfood.world/place/${id}`,
  });
  for (const missing of [hidden, closed, crypto.randomUUID()]) {
    const out = await call("get_place", { id: missing });
    assert.equal(out.body.result?.isError, true);
    assert.deepEqual(out.value, { ok: false, error: "not_found", message: "That place could not be found." });
  }
  assert.equal((await call("get_place", { id: "invalid' OR 1=1" })).value.error, "invalid_id");
});

test("database failures return a clean error without internal details", async () => {
  const out = await call("search_places", { q: "Cafe" });
  assert.equal(out.body.result?.isError, true);
  assert.deepEqual(out.value, { ok: false, error: "unavailable", message: "Member tools are temporarily unavailable. Please try again." });
});

test("GET and DELETE are 405, including direct handler calls", async () => {
  for (const response of [GET(), DELETE(), await handleMemberRequest(new Request(URL))]) {
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("the 64 KB cap counts actual bytes even without an accurate Content-Length", async () => {
  const cases: Record<string, string>[] = [{}, { "content-length": "1" }, { "content-length": String(MAX_BODY_BYTES + 1) }];
  for (const headers of cases) {
    const response = await POST(request("é".repeat(MAX_BODY_BYTES / 2), headers));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const exact = new Request(URL, { method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json" }, body: body.padEnd(MAX_BODY_BYTES) });
  assert.equal((await POST(exact)).status, 200);
});

test("the per-IP read limiter answers 429 once it is exhausted", async () => {
  const keys: string[] = [];
  const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) };
  const request = new Request("https://halalfood.world/api/mcp/member", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const response = await handleMemberRequest(request, undefined, limiter);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.deepEqual(keys, ["member-mcp:203.0.113.9"]);
});

// Production regression: the route's request was not a native Request, and `new Request(request, …)` stringified it
// ("Invalid URL: [object Request]"), so every call answered 500.
test("a request-like object that is not a native Request still works", async () => {
  const native = request({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const requestLike = { url: native.url, method: native.method, headers: native.headers, body: native.body } as unknown as Request;
  const response = await handleMemberRequest(requestLike);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /search_places/);
});

const NOW = Date.parse("2026-10-19T12:00:00Z");
async function memberWorld(scopes: ("read" | "write")[] = ["read", "write"]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const db = setup();
  for (const user of ["member", "other"]) {
    addUser(db.sqlite, user, user, NOW - 60 * DAY);
    addProfile(db.sqlite, user);
  }
  const made = await createMemberKey("member", { name: "Test", scopes }, db.db);
  assert.ok(made.ok);
  const headers = { authorization: `Bearer ${made.key}` };
  const keys: string[] = [];
  env.MEMBER_MCP_WRITE_LIMITER = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } };
  const place = addPlace(db.sqlite);
  return { ...db, headers, made, place, keys };
}

test("member discovery requires Bearer write scope; every protected tool has a clear auth error", async () => {
  const { headers, made, db } = await memberWorld(["read"]);
  for (const authHeaders of [{}, headers, { authorization: made.key }, { authorization: "Bearer hfw_invalid" }, { authorization: "Bearer admin-secret" }]) {
    assert.deepEqual((await rpc("tools/list", {}, authHeaders)).result!.tools!.map((tool) => tool.name).sort(), ["get_place", "search_places"]);
    for (const name of ["whoami", "my_contributions", "verify_place", "rate_place"]) {
      const out = await call(name, {}, authHeaders);
      assert.equal(out.body.result?.isError, true);
      assert.equal(out.value.error, "unauthorized");
      assert.match(out.value.message, /write scope/);
    }
  }
  await revokeMemberKey("member", made.record.id, db);
  assert.equal((await call("whoami", {}, headers)).value.error, "unauthorized");
});

test("whoami reports only the authenticated identity, tier and budgets; revocation is immediate", async () => {
  const { headers, keys, made, db } = await memberWorld();
  const tools = (await rpc("tools/list", {}, headers)).result!.tools!;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["get_place", "my_contributions", "rate_place", "search_places", "verify_place", "whoami"]);
  assert.equal(tools.find((tool) => tool.name === "verify_place")!.annotations!.readOnlyHint, false);
  assert.deepEqual((await call("whoami", {}, headers)).value, { user_id: "member", tier: "new", weight: 0.5, limits_remaining: { vouches: 20, ratings: 30 } });
  assert.deepEqual(keys, [], "private reads do not spend the write burst budget");
  assert.ok((await call("whoami", { user_id: "other" }, headers)).body.result?.isError);
  await revokeMemberKey("member", made.record.id, db);
  assert.equal((await call("whoami", {}, headers)).value.error, "unauthorized");
  assert.equal((await rpc("tools/list")).result!.tools!.length, 2, "no authentication leaks between requests");
});

test("verify_place shares web vouch points, trust, attribution and daily limits", async () => {
  const { headers, sqlite, place, keys, made } = await memberWorld();
  const out = await call("verify_place", { place_id: place, ate_at: "2026-09", rating: "liked", note: "Good" }, headers);
  assert.equal(out.value.status, "accepted");
  assert.equal(out.value.points, 3);
  assert.equal(out.value.trust.communityVouchers, 1);
  assert.deepEqual(out.value.limits_remaining, { vouches: 19, ratings: 30 });
  const contribution = sqlite.prepare("SELECT * FROM contributions").get()!;
  assert.equal(contribution.channel, "mcp");
  assert.equal(contribution.api_key_id, made.record.id);
  assert.deepEqual(keys, [`member-mcp-write:${made.record.id}`]);
  vi.setSystemTime(NOW + 2000);
  assert.equal((await call("verify_place", { place_id: place }, headers)).value.points, 0, "same place pays once");
  assert.equal((await call("verify_place", { place_id: place }, headers)).value.error, "rate_limited", "web cooldown is shared");
  for (const args of [{ place_id: "bad" }, { place_id: place, ate_at: "2999-01" }, { place_id: place, note: "x".repeat(281) }, { place_id: place, rating: "bad" }, { place_id: place, facts: { pork: "no" } }]) {
    assert.equal((await call("verify_place", args, headers)).body.result?.isError, true);
  }
  vi.setSystemTime(NOW + 4000);
  assert.equal((await call("verify_place", { place_id: crypto.randomUUID() }, headers)).value.error, "not_found");
});

test("MCP and web spend the same durable per-user budget", async () => {
  const { headers, place } = await memberWorld();
  for (let i = 0; i < 20; i++) {
    assert.ok((await consumeVouchLimits("member", "unknown", undefined, new Date(NOW - 40000 + i * 1500))).allowed);
  }
  assert.equal((await call("verify_place", { place_id: place }, headers)).value.error, "rate_limited");
  assert.equal((await call("whoami", {}, headers)).value.limits_remaining.vouches, 0);
});

test("verify_place preserves pending moderation for restricted members", async () => {
  const { headers, sqlite, place } = await memberWorld();
  sqlite.prepare("UPDATE profiles SET suspended_at = ? WHERE user_id = 'member'").run(NOW);
  const result = (await call("verify_place", { place_id: place }, headers)).value;
  assert.equal(result.status, "pending");
  assert.equal(result.points, 0);
  assert.equal(result.trust.communityVouchers, 0);
  assert.equal((await call("whoami", {}, headers)).value.tier, "restricted");
});

test("rate_place only updates an existing vouch rating, never its proof, points or trust", async () => {
  const { headers, sqlite, place, made } = await memberWorld();
  assert.equal((await call("rate_place", { place_id: place, rating: "liked" }, headers)).value.error, "not_found");
  await call("verify_place", { place_id: place, ate_at: "2026-09", note: "Keep me" }, headers);
  const before = sqlite.prepare("SELECT * FROM vouches").get()!;
  const trust = sqlite.prepare("SELECT * FROM place_status").get()!;
  vi.setSystemTime(NOW + 2000);
  const out = await call("rate_place", { place_id: place, rating: "loved" }, headers);
  assert.equal(out.value.rating, "loved");
  assert.equal(out.value.points, 0);
  assert.deepEqual(out.value.limits_remaining, { vouches: 19, ratings: 28 });
  assert.deepEqual({ ...sqlite.prepare("SELECT * FROM vouches").get() }, { ...before, rating: "loved" });
  assert.deepEqual(sqlite.prepare("SELECT * FROM place_status").get(), trust);
  assert.equal(sqlite.prepare("SELECT sum(points) AS n FROM contribution_points").get()!.n, 3);
  const rating = sqlite.prepare("SELECT * FROM contributions WHERE kind = 'rating'").get()!;
  assert.equal(rating.api_key_id, made.record.id);
  assert.equal(rating.channel, "mcp");
  for (const args of [{ place_id: place, rating: "okay" }, { place_id: "bad", rating: "liked" }, { place_id: place, rating: "liked", note: "overwrite" }]) {
    assert.equal((await call("rate_place", args, headers)).body.result?.isError, true);
  }
});

test("my_contributions is capped at ten, ordered, private to its member and excludes internal fields", async () => {
  const { headers, sqlite } = await memberWorld();
  for (let i = 0; i < 12; i++) {
    sqlite.prepare("INSERT INTO contributions (id, user_id, kind, channel, status, created_at) VALUES (?, 'member', 'photo', 'web', 'pending', ?)").run(`c${i}`, NOW + i);
  }
  sqlite.prepare("INSERT INTO contributions (id, user_id, kind, channel, status, created_at) VALUES ('secret', 'other', 'photo', 'web', 'accepted', ?)").run(NOW + 50);
  const value = (await call("my_contributions", {}, headers)).value;
  assert.equal(value.contributions.length, 10);
  assert.equal(value.contributions[0].id, "c11");
  assert.deepEqual(Object.keys(value.contributions[0]).sort(), ["channel", "created_at", "id", "kind", "place_id", "status"]);
  assert.ok(value.contributions.every((row: { status: string; id: string }) => row.status === "pending" && row.id !== "secret"));
});

test("write burst limiter is per key, fails closed and never spends daily budgets on rejection", async () => {
  const { headers, place, sqlite } = await memberWorld();
  env.MEMBER_MCP_WRITE_LIMITER = { limit: async () => ({ success: false }) };
  for (const name of ["verify_place", "rate_place"]) {
    assert.equal((await call(name, { place_id: place, rating: "liked" }, headers)).value.error, "rate_limited");
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM auth_otp_rate_limit").get()!.n, 0);
  env.MEMBER_MCP_WRITE_LIMITER = { limit: async () => { throw new Error("private provider details"); } };
  assert.equal((await call("verify_place", { place_id: place }, headers)).value.error, "unavailable");
  delete env.MEMBER_MCP_WRITE_LIMITER;
  assert.equal((await call("verify_place", { place_id: place }, headers)).value.error, "unavailable");
  sqlite.exec("DROP TABLE member_api_keys");
  const response = await POST(request({ jsonrpc: "2.0", id: 1, method: "tools/list" }, headers));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /SQLITE|member_api_keys/);
});

test("ratings stop at 30 per day and reset without any provider calls", async () => {
  const { headers, place, sqlite } = await memberWorld();
  const provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("MCP must not call providers"));
  try {
    await call("verify_place", { place_id: place }, headers);
    for (let i = 0; i < 30; i++) {
      vi.setSystemTime(NOW + (i + 1) * 2000);
      assert.equal((await call("rate_place", { place_id: place, rating: "liked" }, headers)).value.ok, true);
    }
    vi.setSystemTime(NOW + 62000);
    assert.equal((await call("rate_place", { place_id: place, rating: "loved" }, headers)).value.error, "rate_limited");
    assert.equal((await call("whoami", {}, headers)).value.limits_remaining.ratings, 0);
    vi.setSystemTime(NOW + DAY + 62000);
    assert.equal((await call("rate_place", { place_id: place, rating: "loved" }, headers)).value.ok, true);
    assert.equal((await call("whoami", {}, headers)).value.limits_remaining.ratings, 29);
    assert.equal(provider.mock.calls.length, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM contribution_points").get()!.n, 1);
  } finally {
    provider.mockRestore();
  }
});

test("a member cannot rate another member's vouch, and unlisted places cannot be rated", async () => {
  const { headers, place, sqlite } = await memberWorld();
  sqlite.prepare("INSERT INTO vouches (user_id, place_id, ate_at, rating, created_at, updated_at) VALUES ('other', ?, '2026-09', 'liked', ?, ?)").run(place, NOW, NOW);
  assert.equal((await call("rate_place", { place_id: place, rating: "loved" }, headers)).value.error, "not_found");
  assert.equal(sqlite.prepare("SELECT rating FROM vouches WHERE user_id = 'other'").get()!.rating, "liked");
  await call("verify_place", { place_id: place }, headers);
  sqlite.prepare("UPDATE places SET listing_status = 'hidden' WHERE id = ?").run(place);
  vi.setSystemTime(NOW + 2000);
  assert.equal((await call("rate_place", { place_id: place, rating: "loved" }, headers)).value.error, "not_found");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM contributions WHERE kind = 'rating'").get()!.n, 0);
});
