import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  CLAIM_HOLD_MS,
  CLAIM_RENEWAL_GRACE_MS,
  DAY_LABELS,
  FEATURED_PER_CITY,
  OWNER_CLAIM_PERIOD_DAYS,
  OWNER_CLAIM_PRICE_USD,
  claimHoldUntil,
  claimPaidWindow,
  fillViewDays,
  formatDayHours,
  isPaidLive,
  isPublicClaim,
  moderateClaimTransition,
  parseCertifier,
  parseClaimCheckout,
  parseExpiry,
  parseModerateClaimAction,
  parseOwnerClaimEvent,
  parseOwnerHours,
  parseOwnerMenu,
  readOwnerHours,
  totalViews,
  utcDay,
  type ClaimState,
  type DayHours,
} from "./owner-claim";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const PERIOD = OWNER_CLAIM_PERIOD_DAYS * 24 * 60 * 60 * 1000;
const PLACE = "00000000-0000-4000-8000-000000000001";

function state(overrides: Partial<ClaimState> = {}): ClaimState {
  return {
    id: "c1",
    userId: "a",
    status: "active",
    review: "pending",
    renews: true,
    startsAt: NOW,
    activeUntil: NOW + PERIOD,
    createdAt: NOW,
    ...overrides,
  };
}

function message(result: { ok: true } | { ok: false; error: string }): string {
  return result.ok ? "" : result.error;
}

const openDay = (day: DayHours["day"], open = "11:00", close = "22:00"): DayHours => ({ day, closed: false, open, close });
const week = (closed = false) =>
  DAY_LABELS.map((_, day) => (closed ? { day, closed: true, open: null, close: null } : openDay(day as DayHours["day"])));

test("the published price and the sponsored cap are the constants the pages show", () => {
  assert.equal(OWNER_CLAIM_PRICE_USD, 29);
  assert.equal(FEATURED_PER_CITY, 4);
  assert.equal(OWNER_CLAIM_PERIOD_DAYS, 30);
});

test("a paid claim is editable, and the public label waits for a moderator", () => {
  const paid = state();
  assert.equal(isPaidLive(paid, NOW + 1000), true);
  assert.equal(isPublicClaim(paid, NOW + 1000), false);
  assert.equal(isPublicClaim(state({ review: "approved" }), NOW + 1000), true);
  assert.equal(isPublicClaim(state({ review: "approved" }), NOW + PERIOD), false);
  assert.equal(isPaidLive(state({ status: "removed" }), NOW + 1000), false);
  assert.equal(isPaidLive(state({ startsAt: NOW + 5000 }), NOW), false);
  assert.equal(isPaidLive(state({ startsAt: null, activeUntil: null }), NOW), false);
  assert.equal(isPublicClaim(state({ review: "rejected" }), NOW + 1000), false);
});

test("a checkout hold and a renewing paid window block the next buyer", () => {
  const pending = state({ status: "pending", startsAt: null, activeUntil: null });
  assert.equal(claimHoldUntil(pending, NOW + 1000), NOW + CLAIM_HOLD_MS);
  assert.equal(claimHoldUntil(pending, NOW + CLAIM_HOLD_MS), null);
  const live = state();
  assert.equal(claimHoldUntil(live, NOW + 1000), NOW + PERIOD + CLAIM_RENEWAL_GRACE_MS);
  assert.equal(claimHoldUntil(state({ renews: false }), NOW + PERIOD), null);
  assert.equal(claimHoldUntil(state({ status: "ended", activeUntil: null }), NOW), null);
  assert.equal(claimHoldUntil(state({ status: "active", activeUntil: null }), NOW), null);
});

test("the first payment starts now and a renewal extends the same row", () => {
  assert.deepEqual(claimPaidWindow(state({ status: "pending", startsAt: null, activeUntil: null }), NOW), {
    startsAt: NOW,
    activeUntil: NOW + PERIOD,
  });
  assert.deepEqual(claimPaidWindow(state(), NOW + PERIOD - 1000), {
    startsAt: NOW,
    activeUntil: NOW + PERIOD + PERIOD,
  });
  assert.equal(claimPaidWindow(state({ activeUntil: NOW - 1000 }), NOW).activeUntil, NOW + PERIOD);
});

test("checkout input keeps a restaurant id, a role and a contact email", () => {
  assert.deepEqual(parseClaimCheckout({ placeId: PLACE, role: "manager", contactEmail: "  Owner@Cafe.Example  " }), {
    ok: true,
    value: { placeId: PLACE, role: "manager", contactEmail: "owner@cafe.example" },
  });
  assert.equal(parseClaimCheckout(null).ok, false);
  assert.equal(parseClaimCheckout({ placeId: "nope", role: "owner", contactEmail: "a@b.co" }).ok, false);
  assert.equal(parseClaimCheckout({ placeId: PLACE, role: "chef", contactEmail: "a@b.co" }).ok, false);
  assert.equal(parseClaimCheckout({ placeId: PLACE, role: "owner", contactEmail: "not-an-email" }).ok, false);
  assert.equal(parseClaimCheckout({ placeId: PLACE, role: "owner", contactEmail: `${"a".repeat(120)}@b.co` }).ok, false);
  assert.equal(parseClaimCheckout({ placeId: PLACE, role: "owner", contactEmail: "a@b.co\n" }).ok, true);
});

test("hours cover seven days and reject a close that is not later", () => {
  const parsed = parseOwnerHours({ week: week(), note: "  Kitchen closes early on Eid  " });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.note, "Kitchen closes early on Eid");
  assert.equal(formatDayHours(parsed.value.week[0]), "Monday · 11:00–22:00");
  assert.equal(formatDayHours({ day: 0, closed: true, open: null, close: null }), "Monday · Closed");
  assert.equal(formatDayHours({ day: 0, closed: false, open: null, close: null }), "Monday · Closed");
  assert.equal(readOwnerHours(parsed.value.week)?.length, 7);
  assert.equal(readOwnerHours([{ day: 0 }]), null);

  assert.equal(parseOwnerHours(null).ok, false);
  assert.equal(parseOwnerHours({ week: week().slice(0, 6) }).ok, false);
  assert.equal(parseOwnerHours({ week: [null, ...week().slice(1)] }).ok, false);
  const swapped = week();
  swapped[1] = { ...swapped[0], day: 0 };
  assert.match(message(parseOwnerHours({ week: swapped })), /Monday first/);
  const badFlag = week();
  badFlag[2] = { day: 2, closed: "yes" as unknown as boolean, open: null, close: null };
  assert.match(message(parseOwnerHours({ week: badFlag })), /open or closed/);
  const badTime = week();
  badTime[3] = openDay(3, "25:00", "26:00");
  assert.match(message(parseOwnerHours({ week: badTime })), /Thursday/);
  const backwards = week();
  backwards[4] = openDay(4, "22:00", "11:00");
  assert.match(message(parseOwnerHours({ week: backwards })), /Friday/);
  assert.match(message(parseOwnerHours({ week: week(true), note: "x".repeat(161) })), /160/);
  assert.equal(parseOwnerHours({ week: week(true) }).ok, true);
});

test("the owner menu is a list of dishes and not a halal document", () => {
  const parsed = parseOwnerMenu({
    items: [
      { name: "  Haleem  ", section: "Mains", description: "Slow cooked", price: 12.5, currency: "usd" },
      { name: "Chai", price: null },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value[0], { section: "Mains", name: "Haleem", description: "Slow cooked", price: 12.5, currency: "USD" });
  assert.equal(parsed.value[1].price, null);
  assert.equal(parsed.value[1].currency, "USD");

  assert.equal(parseOwnerMenu(null).ok, false);
  assert.equal(parseOwnerMenu({ items: "haleem" }).ok, false);
  assert.match(message(parseOwnerMenu({ items: Array.from({ length: 81 }, () => ({ name: "Dish" })) })), /80/);
  assert.match(message(parseOwnerMenu({ items: [null] })), /name/);
  assert.match(message(parseOwnerMenu({ items: [{ name: "" }] })), /1–/);
  assert.match(message(parseOwnerMenu({ items: [{ name: "x".repeat(161) }] })), /1–/);
  assert.match(message(parseOwnerMenu({ items: [{ name: "Dish", section: "s".repeat(81) }] })), /section/);
  assert.match(message(parseOwnerMenu({ items: [{ name: "Dish", description: "d".repeat(501) }] })), /description/);
  assert.match(message(parseOwnerMenu({ items: [{ name: "Dish", price: -1 }] })), /price/);
  assert.match(message(parseOwnerMenu({ items: [{ name: "Dish", price: "12" }] })), /price/);
  assert.match(message(parseOwnerMenu({ items: [{ name: "Dish", price: 1, currency: "XXX" }] })), /currency/);
  assert.equal(parseOwnerMenu({ items: [] }).ok, true);
});

test("certificate fields and moderator actions stay narrow", () => {
  assert.deepEqual(parseCertifier("  HMC  "), { ok: true, value: "HMC" });
  assert.deepEqual(parseCertifier("   "), { ok: true, value: null });
  assert.equal(parseCertifier("h".repeat(121)).ok, false);
  assert.deepEqual(parseExpiry(undefined, NOW), { ok: true, value: null });
  assert.deepEqual(parseExpiry("", NOW), { ok: true, value: null });
  assert.equal(parseExpiry("09-11-2026", NOW).ok, false);
  assert.equal(parseExpiry("2020-01-01", NOW).ok, false);
  const expiry = parseExpiry("2026-12-01", NOW);
  assert.equal(expiry.ok && expiry.value, Date.parse("2026-12-02T00:00:00Z"));
  assert.equal(parseModerateClaimAction("approve").ok, true);
  assert.match(message(parseModerateClaimAction("publish")), /approve/);

  assert.deepEqual(moderateClaimTransition({ status: "active", review: "pending" }, "approve"), { ok: true, value: { status: "active", review: "approved" } });
  assert.match(message(moderateClaimTransition({ status: "pending", review: "pending" }, "approve")), /paid/);
  assert.match(message(moderateClaimTransition({ status: "active", review: "approved" }, "approve")), /already approved/);
  assert.deepEqual(moderateClaimTransition({ status: "active", review: "approved" }, "reject"), { ok: true, value: { status: "active", review: "rejected" } });
  assert.match(message(moderateClaimTransition({ status: "refunded", review: "approved" }, "reject")), /paid/);
  assert.match(message(moderateClaimTransition({ status: "active", review: "rejected" }, "reject")), /already declined/);
  assert.deepEqual(moderateClaimTransition({ status: "active", review: "approved" }, "remove"), { ok: true, value: { status: "removed", review: "approved" } });
  assert.match(message(moderateClaimTransition({ status: "removed", review: "approved" }, "remove")), /not live/);
  assert.deepEqual(moderateClaimTransition({ status: "removed", review: "approved" }, "restore"), { ok: true, value: { status: "active", review: "approved" } });
  assert.match(message(moderateClaimTransition({ status: "active", review: "approved" }, "restore")), /not removed/);
});

test("view days are a filled UTC window with no negative counts", () => {
  assert.equal(utcDay(NOW), "2026-11-09");
  const filled = fillViewDays([{ day: "2026-11-09", views: 4 }, { day: "2026-11-08", views: -2 }, { day: "nope", views: 9 }], NOW, 3);
  assert.deepEqual(filled, [
    { day: "2026-11-07", views: 0 },
    { day: "2026-11-08", views: 0 },
    { day: "2026-11-09", views: 4 },
  ]);
  assert.equal(totalViews(filled), 4);
  assert.equal(totalViews([{ day: "2026-11-09", views: 1.2 }]), 1.2);
});

test("Whop events for a restaurant claim stay out of the sponsorship parser's jobs", () => {
  const paid = parseOwnerClaimEvent({
    type: "payment.succeeded",
    timestamp: "2026-11-09T12:00:00Z",
    data: { id: "pay_1", membership_id: "mem_1", checkout_configuration_id: "ch_1", metadata: { kind: "owner_claim", claim_id: "c1" } },
  }, NOW);
  assert.deepEqual(paid, { type: "payment.succeeded", paymentId: "pay_1", claimId: "c1", checkoutId: "ch_1", membershipId: "mem_1", paidAt: NOW });
  assert.equal(parseOwnerClaimEvent({ type: "payment.succeeded", data: { id: "pay_1", metadata: { kind: "sponsorship" } } }, NOW), null);
  assert.equal(parseOwnerClaimEvent({ type: "payment.succeeded", data: { metadata: { kind: "owner_claim" } } }, NOW), null);
  assert.equal(parseOwnerClaimEvent({ type: "payment.succeeded", data: { id: "pay_1", membership: { id: "mem_nested" }, metadata: { kind: "owner_claim" }, paid_at: "not-a-date" } }, NOW)?.type, "payment.succeeded");

  assert.equal(parseOwnerClaimEvent({ type: "membership.deactivated", data: { id: "mem_1", metadata: { kind: "owner_claim", claim_id: "c1" } } }, NOW)?.type, "membership.deactivated");
  assert.equal(parseOwnerClaimEvent({ type: "membership.updated", data: { id: "mem_1", status: "canceled", metadata: { kind: "owner_claim" } } }, NOW)?.type, "membership.deactivated");
  assert.equal(parseOwnerClaimEvent({ type: "membership.cancel_at_period_end_changed", data: { id: "mem_1", status: "active", cancel_at_period_end: true, metadata: { kind: "owner_claim" } } }, NOW)?.type, "membership.deactivated");
  assert.deepEqual(parseOwnerClaimEvent({ type: "membership.updated", data: { id: "mem_1", status: "trialing", cancel_at_period_end: false, metadata: { kind: "owner_claim", claim_id: "c1" } } }, NOW), {
    type: "membership.renewing", membershipId: "mem_1", claimId: "c1",
  });
  assert.equal(parseOwnerClaimEvent({ type: "membership.updated", data: { id: "mem_1", status: "past_due", metadata: { kind: "owner_claim" } } }, NOW), null);
  assert.equal(parseOwnerClaimEvent({ type: "membership.updated", data: { status: "active", cancel_at_period_end: false, metadata: { kind: "owner_claim" } } }, NOW), null);
  assert.equal(parseOwnerClaimEvent({ type: "membership.updated", data: { id: "mem_1", status: "active", cancel_at_period_end: false, metadata: { kind: "newsletter" } } }, NOW), null);

  assert.deepEqual(parseOwnerClaimEvent({ type: "refund.updated", data: { status: "succeeded", payment_id: "pay_1" } }, NOW), { type: "refund", paymentId: "pay_1", membershipId: null });
  assert.equal(parseOwnerClaimEvent({ type: "refund.created", data: { status: "pending", payment_id: "pay_1", metadata: { kind: "owner_claim" } } }, NOW), null);
  assert.equal(parseOwnerClaimEvent({ type: "refund.created", data: { status: "succeeded", metadata: { kind: "sponsorship" }, payment: { id: "pay_1" } } }, NOW), null);
  assert.equal(parseOwnerClaimEvent({ type: "refund.created", data: { status: "succeeded" } }, NOW), null);
  assert.deepEqual(parseOwnerClaimEvent({ type: "refund.created", data: { status: "succeeded", payment: { id: "pay_2", membership: { id: "mem_2" }, metadata: { kind: "owner_claim" } } } }, NOW), {
    type: "refund", paymentId: "pay_2", membershipId: "mem_2",
  });
  assert.equal(parseOwnerClaimEvent({ type: "dispute.created" }, NOW), null);
  assert.equal(parseOwnerClaimEvent(null, NOW), null);
});

test("halal status code does not read restaurant claims", () => {
  const halal = readFileSync(new URL("./halal.ts", import.meta.url), "utf8");
  const places = readFileSync(new URL("../places.ts", import.meta.url), "utf8");
  assert.equal(halal.includes("owner_claims"), false);
  assert.equal(halal.includes("owner-claim"), false);
  assert.equal(places.includes("owner_claims"), false);
  assert.equal(places.includes("owner_menu_items"), false);
});
