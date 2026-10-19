import { test } from "vitest";
import assert from "node:assert/strict";
import { CHECKOUT_HOLD_MS, SPONSOR_PERIOD_DAYS, parseSponsorInput, type SponsorInput } from "@/lib/core/sponsorship";
import { addProfile, addUser, createTestDatabase, DAY } from "@/lib/testing/sqlite-d1";
import { deleteAccount } from "./profiles";
import {
  applyWhopEvent,
  attachCheckout,
  citySponsorship,
  discardPending,
  listSponsorshipsForAdmin,
  liveSponsor,
  liveSponsorsByCity,
  moderateSponsorship,
  mySponsorships,
  startSponsorship,
} from "./sponsorships";

const PERIOD = SPONSOR_PERIOD_DAYS * DAY;
const NOW = Date.parse("2026-10-18T12:00:00Z");

function input(overrides: Record<string, unknown> = {}): SponsorInput {
  const parsed = parseSponsorInput({ citySlug: "mumbai", name: "Noor Grill", tagline: "Charcoal kebabs", linkUrl: "https://noor.example.com", ...overrides });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function world() {
  const { sqlite, db } = createTestDatabase();
  for (const id of ["a", "b", "mod"]) {
    addUser(sqlite, id);
    addProfile(sqlite, id);
  }
  const row = (id: string) => sqlite.prepare(`SELECT * FROM city_sponsorships WHERE id = ?`).get(id) as Record<string, unknown>;
  return { sqlite, db, row };
}

const paid = (sponsorshipId: string | null, paidAt: number, extra: Record<string, unknown> = {}) => ({
  type: "payment.succeeded" as const,
  paymentId: `pay-${paidAt}`,
  sponsorshipId,
  checkoutId: null,
  membershipId: "mem_1",
  paidAt,
  ...extra,
});

test("a checkout holds the city for others; payment makes the card live", async () => {
  const { db, row } = world();
  const started = await startSponsorship("a", input(), db, NOW);
  assert.ok(started.ok);
  const id = started.ok ? started.id : "";
  await attachCheckout(id, "ch_1", db, NOW);
  assert.equal(row(id).whop_checkout_id, "ch_1");

  const blocked = await startSponsorship("b", input({ name: "Other" }), db, NOW + 1000);
  assert.deepEqual(blocked, { ok: false, status: 409, error: "Someone is checking out for this city. Try again in an hour." });
  assert.equal((await citySponsorship("mumbai", "a", db, NOW)).availability.open, true);
  assert.equal(await liveSponsor("mumbai", db, NOW), null);

  // Found by checkout id even without metadata.
  assert.equal(await applyWhopEvent("msg_1", paid(null, NOW + 5000, { checkoutId: "ch_1" }), db, NOW + 5000), "applied");
  const live = await liveSponsor("mumbai", db, NOW + 6000);
  assert.deepEqual(live, { id, citySlug: "mumbai", name: "Noor Grill", tagline: "Charcoal kebabs", linkUrl: "https://noor.example.com/" });
  assert.equal(row(id).active_until, NOW + 5000 + PERIOD);
  assert.equal(row(id).whop_membership_id, "mem_1");
  assert.equal(await liveSponsor("delhi", db, NOW + 6000), null);

  const view = await citySponsorship("mumbai", "b", db, NOW + 6000);
  assert.equal(view.availability.open, false);
  assert.equal(view.sponsor?.id, id);
  assert.deepEqual([...(await liveSponsorsByCity(db, NOW + 6000)).keys()], ["mumbai"]);
  assert.deepEqual(await startSponsorship("b", input(), db, NOW + 6000), { ok: false, status: 409, error: "This city already has a sponsor." });
});

test("webhooks are idempotent, renewals extend, cancellation stops renewing, refunds hide", async () => {
  const { db, row } = world();
  const started = await startSponsorship("a", input(), db, NOW);
  const id = started.ok ? started.id : "";
  assert.equal(await applyWhopEvent("msg_1", paid(id, NOW), db, NOW), "applied");
  assert.equal(await applyWhopEvent("msg_1", paid(id, NOW), db, NOW), "duplicate");
  assert.equal(row(id).active_until, NOW + PERIOD);

  assert.equal(await applyWhopEvent("msg_2", paid(id, NOW + PERIOD - DAY), db, NOW + PERIOD - DAY), "applied");
  assert.equal(row(id).active_until, NOW + 2 * PERIOD);
  assert.equal(row(id).starts_at, NOW);

  await applyWhopEvent("msg_3", { type: "membership.deactivated", membershipId: "mem_1", sponsorshipId: null }, db, NOW + PERIOD);
  assert.equal(row(id).renews, 0);
  assert.ok(await liveSponsor("mumbai", db, NOW + PERIOD + DAY));
  // Without renewal the city opens the moment the paid window ends.
  assert.equal((await citySponsorship("mumbai", "b", db, NOW + 2 * PERIOD)).availability.open, true);

  await applyWhopEvent("msg_4", { type: "refund", paymentId: `pay-${NOW + PERIOD - DAY}`, membershipId: null }, db, NOW + PERIOD + DAY);
  assert.equal(row(id).status, "refunded");
  assert.equal(await liveSponsor("mumbai", db, NOW + PERIOD + DAY), null);
  // A payment for a refunded sponsorship doesn't bring it back.
  assert.equal(await applyWhopEvent("msg_5", paid(id, NOW + PERIOD + 2 * DAY), db, NOW + PERIOD + 2 * DAY), "unmatched");
  assert.equal(await applyWhopEvent("msg_6", paid("nope", NOW), db, NOW), "unmatched");
  assert.equal(await applyWhopEvent("msg_7", { type: "ignored", name: "dispute.created" }, db, NOW), "ignored");
  assert.equal(await applyWhopEvent("msg_7", { type: "ignored", name: "dispute.created" }, db, NOW), "duplicate");
});

test("a late payment after its hold lapsed queues behind the sponsor who took the city", async () => {
  const { db, row } = world();
  const first = await startSponsorship("a", input(), db, NOW);
  const firstId = first.ok ? first.id : "";
  const second = await startSponsorship("b", input({ name: "Late" }), db, NOW + CHECKOUT_HOLD_MS + 1);
  assert.ok(second.ok);
  const secondId = second.ok ? second.id : "";
  await applyWhopEvent("msg_b", paid(secondId, NOW + CHECKOUT_HOLD_MS + 2), db, NOW + CHECKOUT_HOLD_MS + 2);
  await applyWhopEvent("msg_a", paid(firstId, NOW + CHECKOUT_HOLD_MS + 3, { membershipId: "mem_2" }), db, NOW + CHECKOUT_HOLD_MS + 3);
  assert.equal(row(firstId).starts_at, row(secondId).active_until);
  assert.equal((await liveSponsor("mumbai", db, NOW + CHECKOUT_HOLD_MS + 10))?.id, secondId);
  assert.equal((await liveSponsor("mumbai", db, Number(row(secondId).active_until) + 1))?.id, firstId);
});

test("a failed checkout frees the city; abandoned checkouts drop off the buyer's list", async () => {
  const { db } = world();
  const started = await startSponsorship("a", input(), db, NOW);
  const id = started.ok ? started.id : "";
  assert.equal((await mySponsorships("a", db, NOW)).length, 1);
  assert.equal((await mySponsorships("a", db, NOW + 2 * DAY)).length, 0);
  await discardPending(id, db);
  assert.equal((await citySponsorship("mumbai", "b", db, NOW)).availability.open, true);
  assert.deepEqual(await mySponsorships("b", db, NOW), []);
});

test("moderators take a card down and restore it, audited; pending rows aren't theirs to touch", async () => {
  const { db, sqlite } = world();
  const started = await startSponsorship("a", input(), db, NOW);
  const id = started.ok ? started.id : "";
  assert.deepEqual(await moderateSponsorship(id, "mod", "remove", null, db, NOW), { ok: false, status: 404, error: "That sponsorship could not be found." });
  await applyWhopEvent("msg_1", paid(id, NOW), db, NOW);
  assert.deepEqual(await moderateSponsorship(id, "mod", "restore", null, db, NOW), { ok: false, status: 409, error: "That sponsorship was not removed." });
  assert.deepEqual(await moderateSponsorship(id, "mod", "remove", "Misleading", db, NOW), { ok: true });
  assert.equal(await liveSponsor("mumbai", db, NOW + 1), null);
  const admin = await listSponsorshipsForAdmin(db, NOW + 1);
  assert.equal(admin[0].status, "removed");
  assert.equal(admin[0].buyer, "a");
  assert.deepEqual(await moderateSponsorship(id, "mod", "restore", null, db, NOW), { ok: true });
  assert.ok(await liveSponsor("mumbai", db, NOW + 1));
  const audits = sqlite.prepare(`SELECT action FROM audit_log WHERE target_id = ? ORDER BY rowid`).all(id) as { action: string }[];
  assert.deepEqual(audits.map((audit) => audit.action), ["remove-sponsorship", "restore-sponsorship"]);
});

test("deleting the buyer's account keeps the paid sponsorship without linking back", async () => {
  const { db, row } = world();
  const started = await startSponsorship("a", input(), db, NOW);
  const id = started.ok ? started.id : "";
  await applyWhopEvent("msg_1", paid(id, NOW), db, NOW);
  await deleteAccount("a", db, NOW);
  assert.equal(row(id).user_id, null);
  assert.ok(await liveSponsor("mumbai", db, NOW + 1));
  assert.equal((await listSponsorshipsForAdmin(db, NOW + 1))[0].buyer, null);
});


test("renewal can resume only for an active sponsorship", async () => {
  const { db, row } = world();
  const started = await startSponsorship("a", input(), db, NOW);
  const id = started.ok ? started.id : "";
  await applyWhopEvent("pay", paid(id, NOW), db, NOW);
  await applyWhopEvent("stop", { type: "membership.deactivated", membershipId: "mem_1", sponsorshipId: null }, db, NOW);
  assert.equal(row(id).renews, 0);
  await applyWhopEvent("resume", { type: "membership.renewing", membershipId: "mem_1", sponsorshipId: null }, db, NOW);
  assert.equal(row(id).renews, 1);
  await applyWhopEvent("refund", { type: "refund", paymentId: `pay-${NOW}`, membershipId: null }, db, NOW);
  await applyWhopEvent("late-resume", { type: "membership.renewing", membershipId: "mem_1", sponsorshipId: id }, db, NOW);
  assert.equal(row(id).renews, 0);
  assert.equal(row(id).status, "refunded");
});
