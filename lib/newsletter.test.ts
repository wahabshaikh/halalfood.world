import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { env } from "@/lib/testing/cloudflare-workers";
import { addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";
import type { NewsletterMembership } from "@/lib/core/newsletter";
import { applyNewsletterEvent, newsletterStatusForUser } from "./newsletter";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const membership = (extra: Partial<NewsletterMembership> = {}): NewsletterMembership => ({
  id: "mem_news", userId: "a", whopUserId: "user_whop", productId: "prod_news", planId: "plan_news", status: "active",
  cancelAtPeriodEnd: false, currentPeriodEnd: NOW + 86400000, manageUrl: "https://whop.com/manage/mem_news", eventAt: NOW, ...extra,
});

afterEach(() => {
  delete env.WHOP_API_KEY;
  delete env.WHOP_NEWSLETTER_PRODUCT_ID;
  vi.unstubAllGlobals();
});

test("newsletter memberships are idempotent and older events cannot revoke newer access", async () => {
  const { db, sqlite } = createTestDatabase();
  addUser(sqlite, "a");
  await applyNewsletterEvent(membership(), db, NOW);
  await applyNewsletterEvent(membership(), db, NOW + 1000);
  await applyNewsletterEvent(membership({ status: "expired", eventAt: NOW - 1000 }), db, NOW + 2000);
  assert.deepEqual(await newsletterStatusForUser("a", db), { subscribed: true, manageUrl: "https://whop.com/manage/mem_news" });
  const row = sqlite.prepare("SELECT * FROM whop_memberships").get() as Record<string, unknown>;
  assert.equal(row.created_at, NOW);
  assert.equal(row.updated_at, NOW);
  assert.equal(row.event_at, NOW);
  assert.equal(row.cancel_at_period_end, 0);
  await applyNewsletterEvent(membership({ status: "canceling", cancelAtPeriodEnd: true, userId: null, eventAt: NOW + 3000 }), db, NOW + 3000);
  assert.equal((await newsletterStatusForUser("a", db)).subscribed, true);
  await applyNewsletterEvent(membership({ status: "expired", eventAt: NOW + 4000 }), db);
  assert.equal((await newsletterStatusForUser("a", db)).subscribed, false);
  assert.deepEqual(await newsletterStatusForUser("b", db), { subscribed: false, manageUrl: null });
});

test("newsletter history survives account deletion and unknown account metadata does not break delivery", async () => {
  const { db, sqlite } = createTestDatabase();
  addUser(sqlite, "a");
  await applyNewsletterEvent(membership(), db);
  sqlite.prepare('DELETE FROM "user" WHERE id = ?').run("a");
  await applyNewsletterEvent(membership({ status: "canceled", eventAt: NOW + 1 }), db);
  assert.equal((sqlite.prepare("SELECT user_id FROM whop_memberships").get() as { user_id: unknown }).user_id, null);
  assert.equal((await newsletterStatusForUser("a", db)).subscribed, false);
  await applyNewsletterEvent(membership({ id: "mem_unknown", userId: "missing" }), db);
  assert.equal((sqlite.prepare("SELECT user_id FROM whop_memberships WHERE id = 'mem_unknown'").get() as { user_id: unknown }).user_id, null);
});

test("Whop access confirms both grants and revocations; errors fall back to D1", async () => {
  const { db, sqlite } = createTestDatabase();
  addUser(sqlite, "a");
  await applyNewsletterEvent(membership(), db);
  env.WHOP_API_KEY = "test_key";
  env.WHOP_NEWSLETTER_PRODUCT_ID = "prod_news";
  for (const access of [false, true]) {
    vi.stubGlobal("fetch", async () => Response.json({ has_access: access }));
    assert.equal((await newsletterStatusForUser("a", db)).subscribed, access);
  }
  vi.stubGlobal("fetch", async () => { throw new DOMException("Timed out", "TimeoutError"); });
  assert.equal((await newsletterStatusForUser("a", db)).subscribed, true);
  await applyNewsletterEvent(membership({ status: "expired", eventAt: NOW + 1 }), db);
  assert.equal((await newsletterStatusForUser("a", db)).subscribed, false);
  vi.stubGlobal("fetch", async () => Response.json({ has_access: true }));
  assert.equal((await newsletterStatusForUser("a", db)).subscribed, true);
});

test("another active membership keeps access and repeated Whop users are checked once", async () => {
  const { db, sqlite } = createTestDatabase();
  addUser(sqlite, "a");
  await applyNewsletterEvent(membership(), db);
  await applyNewsletterEvent(membership({ id: "mem_new", status: "expired", eventAt: NOW + 1 }), db);
  assert.equal((await newsletterStatusForUser("a", db)).subscribed, true);
  env.WHOP_API_KEY = "test_key";
  env.WHOP_NEWSLETTER_PRODUCT_ID = "prod_news";
  const fetcher = vi.fn(async () => Response.json({ has_access: false }));
  vi.stubGlobal("fetch", fetcher);
  assert.equal((await newsletterStatusForUser("a", db)).subscribed, false);
  assert.equal(fetcher.mock.calls.length, 1);
});


test("Whop migration can run again after the old sponsorship tables were already applied", () => {
  const { sqlite } = createTestDatabase();
  const migration = readFileSync(new URL("../migrations/0009_whop.sql", import.meta.url), "utf8");
  sqlite.exec(migration);
  sqlite.exec(migration);
  const indexes = sqlite.prepare("PRAGMA index_list(whop_memberships)").all() as { name: string }[];
  assert.ok(indexes.some((index) => index.name === "whop_memberships_user_idx"));
});
