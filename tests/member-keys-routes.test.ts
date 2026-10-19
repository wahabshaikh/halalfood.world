import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { env } from "@/lib/testing/cloudflare-workers";
import { DAY, addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";
import { GET, POST } from "@/app/api/me/keys/route";
import { DELETE } from "@/app/api/me/keys/[id]/route";

const auth = vi.hoisted(() => ({ userId: "a" as string | null }));
vi.mock("@/lib/auth-session", () => ({
  getRequestAuth: async () => (auth.userId ? { status: "authenticated", userId: auth.userId } : { status: "unauthenticated" }),
}));

beforeEach(() => {
  const { sqlite, binding } = createTestDatabase();
  addUser(sqlite, "a");
  addUser(sqlite, "b");
  addUser(sqlite, "young", "young", Date.now() - DAY);
  env.DB = binding;
  auth.userId = "a";
  // Personal writes have a short cooldown: step the clock past it between requests.
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  delete env.DB;
  vi.useRealTimers();
});

const URL_BASE = "http://localhost:5173/api/me/keys";
const post = (body: string) => {
  vi.setSystemTime(Date.now() + 1000);
  return POST(new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body }));
};
const revoke = (id: string) => DELETE(new Request(`${URL_BASE}/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

test("key routes need a session", async () => {
  auth.userId = null;
  assert.equal((await GET(new Request(URL_BASE))).status, 401);
  assert.equal((await post(JSON.stringify({ name: "Claude" }))).status, 401);
  assert.equal((await revoke(crypto.randomUUID())).status, 401);
});

test("create shows the key once, list shows the prefix only, revoke removes it", async () => {
  assert.equal((await post("bad")).status, 400);
  assert.equal((await post(JSON.stringify({ name: "" }))).status, 400);
  const created = await post(JSON.stringify({ name: "Claude", scopes: ["read"] }));
  assert.equal(created.status, 201);
  const { key, record } = (await created.json()) as { key: string; record: { id: string; prefix: string; scopes: string[] } };
  assert.match(key, /^hfw_/);
  assert.deepEqual(record.scopes, ["read"]);

  const listed = await GET(new Request(URL_BASE));
  const text = await listed.text();
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), "no-store");
  assert.ok(!text.includes(key), "the key is never listed");
  assert.ok(!text.includes("hash"));
  assert.equal(JSON.parse(text).keys[0].prefix, key.slice(0, 8));

  auth.userId = "b";
  assert.equal((await revoke(record.id)).status, 404, "someone else's key");
  auth.userId = "a";
  assert.equal((await revoke("not-a-uuid")).status, 400);
  assert.equal((await revoke(record.id)).status, 200);
  assert.deepEqual((await (await GET(new Request(URL_BASE))).json()).keys, []);
});

test("create enforces the age gate and the 3-key limit", async () => {
  auth.userId = "young";
  const young = await post(JSON.stringify({ name: "Claude" }));
  assert.equal(young.status, 403);
  assert.match((await young.json()).error, /7 days/);
  auth.userId = "a";
  for (let i = 0; i < 3; i += 1) assert.equal((await post(JSON.stringify({ name: `Key ${i}` }))).status, 201);
  assert.equal((await post(JSON.stringify({ name: "Key 4" }))).status, 409);
});
