import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { POST, GET, DELETE } from "@/app/api/mcp/member/route";
import { env } from "@/lib/testing/cloudflare-workers";
import { addPlace, createTestDatabase } from "@/lib/testing/sqlite-d1";
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

async function rpc(method: string, params: unknown = {}) {
  const response = await POST(request({ jsonrpc: "2.0", id: 1, method, params }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data ? data.slice(6) : text) as RpcBody;
}

async function call(name: string, args: unknown) {
  const body = await rpc("tools/call", { name, arguments: args });
  const text = body.result?.content?.[0]?.text;
  return { body, value: text?.startsWith("{") ? JSON.parse(text) : null };
}

test("initialize and tools/list are public without an admin token or a database", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result?.serverInfo?.name, "halalfood-world");
  assert.match(init.result!.instructions!, /read-only for now/);
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
  assert.deepEqual(out.value, { ok: false, error: "unavailable", message: "Places are temporarily unavailable. Please try again." });
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
