import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { env } from "@/lib/testing/cloudflare-workers";
import { addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";
import { POST } from "@/app/api/newsletter/checkout/route";

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/auth-session", () => ({ getRequestAuth: async () => auth.signedIn ? { status: "authenticated", userId: "a" } : { status: "unauthenticated" } }));

beforeEach(() => {
  const { sqlite, binding } = createTestDatabase();
  addUser(sqlite, "a");
  env.DB = binding;
  auth.signedIn = true;
});
afterEach(() => {
  for (const key of ["DB", "WHOP_API_KEY", "WHOP_NEWSLETTER_PLAN_ID", "WHOP_NEWSLETTER_PRODUCT_ID"]) delete env[key];
  vi.unstubAllGlobals();
});
const request = (body = "{}") => new Request("http://localhost:5173/api/newsletter/checkout", { method: "POST", headers: { "content-type": "application/json" }, body });
const configure = () => {
  env.WHOP_API_KEY = "test_key";
  env.WHOP_NEWSLETTER_PLAN_ID = "plan_news";
  env.WHOP_NEWSLETTER_PRODUCT_ID = "prod_news";
};

test("newsletter checkout needs a session before validation or billing", async () => {
  auth.signedIn = false;
  const response = await POST(request("bad"));
  assert.equal(response.status, 401);
  assert.match((await response.json()).loginUrl, /newsletter/);
});

test("newsletter checkout validates JSON objects", async () => {
  for (const body of ["bad", "null", "[]", '"text"']) assert.equal((await POST(request(body))).status, 400);
});

test("newsletter checkout is unavailable without configuration", async () => {
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not available yet/);
});

test("newsletter checkout returns Whop's URL and rate limits repeated attempts", async () => {
  configure();
  const fetcher = vi.fn(async () => Response.json({ id: "ch_news", purchase_url: "https://whop.com/checkout/news" }));
  vi.stubGlobal("fetch", fetcher);
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: "https://whop.com/checkout/news" });
  const body = JSON.parse(String((fetcher.mock.calls as unknown as [string, RequestInit][])[0][1].body));
  assert.equal(body.metadata.user_id, "a");
  assert.equal(body.redirect_url, "http://localhost:5173/newsletter");
  assert.equal((await POST(request())).status, 429);
  assert.equal(fetcher.mock.calls.length, 1);
});

test("newsletter provider failures return a user-facing 503", async () => {
  configure();
  vi.stubGlobal("fetch", async () => new Response("private provider detail", { status: 500 }));
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Checkout could not be opened. Please try again." });
});
