import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { env } from "@/lib/testing/cloudflare-workers";
import { addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";
import { POST as paste } from "@/app/api/videos/route";
import { POST as picks } from "@/app/api/videos/[id]/places/route";
import { POST as review } from "@/app/api/admin/videos/[id]/route";
import { GET as queue } from "@/app/api/admin/videos/route";

const auth = vi.hoisted(() => ({ signedIn: true, moderator: false }));
vi.mock("@/lib/auth-session", () => ({ getRequestAuth: async () => auth.signedIn ? { status: "authenticated", userId: "a" } : { status: "unauthenticated" } }));
vi.mock("@/lib/moderators", () => ({ isModerator: async () => auth.moderator }));
const id = "11111111-2222-4333-8444-555555555555";
const params = { params: Promise.resolve({ id }) };
const request = (body = "{}") => new Request("http://localhost:5173/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body });

beforeEach(() => {
  const { sqlite, binding } = createTestDatabase();
  addUser(sqlite, "a");
  env.DB = binding;
  auth.signedIn = true;
  auth.moderator = false;
});
afterEach(() => { delete env.DB; vi.unstubAllGlobals(); });

test("video routes require a session, and review requires a moderator", async () => {
  auth.signedIn = false;
  assert.equal((await paste(request())).status, 401);
  assert.equal((await picks(request(), params)).status, 401);
  assert.equal((await review(request(), params)).status, 401);
  auth.signedIn = true;
  assert.equal((await review(request(), params)).status, 403);
  assert.equal((await queue(request())).status, 403);
});

test("video routes validate input before fetching or mutating", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const body of ["bad", "null", "[]", '{}', '{"url":"https://evil.example/watch?v=dQw4w9WgXcQ"}'])
    assert.equal((await paste(request(body))).status, 400);
  assert.equal((await picks(request('{"placeIds":[]}'), params)).status, 400);
  assert.equal((await picks(request(), { params: Promise.resolve({ id: "bad" }) })).status, 400);
  auth.moderator = true;
  assert.equal((await review(request('{"userId":"a","decision":"delete"}'), params)).status, 400);
  assert.equal(fetcher.mock.calls.length, 0);
});

test("the eleventh paste is rejected before another provider request", async () => {
  const fetcher = vi.fn(async () => new Response("not found", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  for (let n = 0; n < 10; n++) assert.equal((await paste(request('{"url":"https://youtu.be/dQw4w9WgXcQ"}'))).status, 404);
  assert.equal((await paste(request('{"url":"https://youtu.be/dQw4w9WgXcQ"}'))).status, 429);
  assert.equal(fetcher.mock.calls.length, 10);
});
