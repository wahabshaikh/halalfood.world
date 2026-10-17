/** The certifier routes end to end over the real migrations: public reads, alert sign-ups and moderator gates. */
import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { env } from "cloudflare:workers";
import { createTestDatabase } from "@/lib/testing/sqlite-d1";
import { GET as listGet } from "@/app/api/certifiers/route";
import { GET as oneGet } from "@/app/api/certifiers/[slug]/route";
import { POST as alertsPost } from "@/app/api/certifiers/alerts/route";
import { POST as checkPost } from "@/app/api/certifiers/check/route";
import { GET as pendingGet } from "@/app/api/admin/certifier-changes/route";
import { POST as reviewPost } from "@/app/api/admin/certifier-changes/[id]/route";
import { GET as csvGet } from "@/app/certifiers/country/indonesia.csv/route";
import { GET as feedGet } from "@/app/certifiers/changes.xml/route";

let world: ReturnType<typeof createTestDatabase>;

beforeEach(() => {
  world = createTestDatabase();
  env.DB = world.binding;
});

afterEach(() => {
  delete env.DB;
  vi.unstubAllGlobals();
});

const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) });

test("GET /api/certifiers lists every recognised body, optionally by where it is based", async () => {
  const all = await (await listGet(new Request("https://halalfood.world/api/certifiers"))).json();
  assert.equal(all.certifiers.length, 124);
  const anic = all.certifiers.find((each: { slug: string }) => each.slug === "anic-halal-authority");
  assert.equal(anic.recognitions[0].validUntil, "2030-06-30");
  assert.equal(anic.recognitions[0].authority, "bpjph");
  assert.equal(anic.recognitions[0].importingCountry, "ID");
  assert.equal(anic.recognitions[0].officialList, "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri");
  assert.equal(all.sources[0].lastCheckedAt, "2026-10-17T10:00:00.000Z");
  const au = await (await listGet(new Request("https://halalfood.world/api/certifiers?country=au"))).json();
  assert.equal(au.certifiers.length, 14);
  assert.equal((await listGet(new Request("https://halalfood.world/api/certifiers?country=australia"))).status, 400);
});

test("GET /api/certifiers/[slug] returns one body, 404s unknown slugs and 308s renamed ones", async () => {
  const anic = await (await oneGet(new Request("https://halalfood.world/api/certifiers/anic-halal-authority"), slugParams("anic-halal-authority"))).json();
  assert.equal(anic.name, "ANIC Halal Authority");
  assert.equal(anic.basedIn.countryName, "Australia");
  assert.deepEqual(anic.changes, []);
  assert.equal((await oneGet(new Request("https://halalfood.world/api/certifiers/x"), slugParams("nobody-at-all"))).status, 404);
  assert.equal((await oneGet(new Request("https://halalfood.world/api/certifiers/x"), slugParams("../etc"))).status, 404);
  world.sqlite.prepare(`INSERT INTO certifier_slug_history (old_slug, certifier_id, created_at) VALUES ('anic-old', '439c0f0a-a1f2-40ca-ac6d-251d0be94549', 1)`).run();
  const moved = await oneGet(new Request("https://halalfood.world/api/certifiers/anic-old"), slugParams("anic-old"));
  assert.equal(moved.status, 308);
  assert.equal(moved.headers.get("location"), "https://halalfood.world/api/certifiers/anic-halal-authority");
});

test("the Indonesia CSV and the changes feed render from the same data", async () => {
  const csv = await csvGet();
  assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
  const lines = (await csv.text()).trim().split("\r\n");
  assert.equal(lines.length, 125);
  assert.match(lines[0], /^name,based_in_city,/);
  assert.ok(lines.some((line) => line.startsWith("ANIC Halal Authority,") && line.includes(",2030-06-30,")));
  const feed = await feedGet();
  assert.equal(feed.headers.get("content-type"), "application/atom+xml; charset=utf-8");
  assert.match(await feed.text(), /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
});

function signup(body: unknown, host = "http://127.0.0.1:5173", ip = "198.51.100.7") {
  return new Request(`${host}/api/certifiers/alerts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = { email: "Exporter@Example.com", certifiers: ["anic-halal-authority"], scopes: ["food"], turnstileToken: "token" };

test("alert sign-ups validate input before anything else", async () => {
  assert.equal((await alertsPost(signup("{"))).status, 400);
  const bad = await alertsPost(signup({ ...valid, email: "nope" }));
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "Enter a valid email address." });
  assert.equal((await alertsPost(signup({ ...valid, scopes: ["pork"] }))).status, 400);
  assert.equal((await alertsPost(signup({ ...valid, authorities: ["jakim"] }))).status, 400);
  assert.equal((await alertsPost(signup({ ...valid, turnstileToken: "" }))).status, 400);
  assert.equal(world.sqlite.prepare(`SELECT count(*) AS n FROM cert_alert_sub`).get()!.n, 0);
});

test("production fails closed without Turnstile keys", async () => {
  const response = await alertsPost(signup(valid, "https://halalfood.world"));
  assert.equal(response.status, 503);
});

test("a rejected Turnstile token is a 400 and stores nothing", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ success: false }));
  const response = await alertsPost(signup(valid));
  assert.equal(response.status, 400);
  assert.equal(world.sqlite.prepare(`SELECT count(*) AS n FROM cert_alert_sub`).get()!.n, 0);
});

test("a valid sign-up is stored unconfirmed and weekly, then the per-email budget applies", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ success: true }));
  const response = await alertsPost(signup(valid));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, confirmed: false });
  const row = world.sqlite.prepare(`SELECT email, frequency, confirmed_at, filter_json FROM cert_alert_sub`).get() as Record<string, unknown>;
  assert.equal(row.email, "exporter@example.com");
  assert.equal(row.frequency, "weekly");
  assert.equal(row.confirmed_at, null);
  assert.deepEqual(JSON.parse(String(row.filter_json)), { authorities: ["bpjph"], certifiers: ["anic-halal-authority"], scopes: ["food"] });
  const again = await alertsPost(signup(valid, undefined, "198.51.100.8"));
  assert.equal(again.status, 429);
  assert.ok(Number(again.headers.get("retry-after")) > 0);
});

test("the check and the review queue are for moderators only", async () => {
  const check = await checkPost(new Request("http://127.0.0.1:5173/api/certifiers/check", { method: "POST" }));
  assert.equal(check.status, 401);
  assert.equal((await pendingGet(new Request("http://127.0.0.1:5173/api/admin/certifier-changes"))).status, 401);
  const review = await reviewPost(
    new Request("http://127.0.0.1:5173/api/admin/certifier-changes/x", { method: "POST", body: JSON.stringify({ decision: "approve" }) }),
    { params: Promise.resolve({ id: "x" }) },
  );
  assert.equal(review.status, 401);
});
