import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CHECKOUT_HOLD_MS,
  RENEWAL_GRACE_MS,
  SPONSOR_PERIOD_DAYS,
  cityAvailability,
  holdUntil,
  isLive,
  paidWindow,
  parseSponsorInput,
  parseWhopEvent,
  sponsorLink,
  type SponsorshipState,
} from "./sponsorship";

const DAY = 24 * 60 * 60 * 1000;
const PERIOD = SPONSOR_PERIOD_DAYS * DAY;
const NOW = Date.parse("2026-10-18T12:00:00Z");

function row(overrides: Partial<SponsorshipState> = {}): SponsorshipState {
  return { id: "s1", userId: "a", status: "active", renews: true, startsAt: NOW - DAY, activeUntil: NOW + 10 * DAY, createdAt: NOW - DAY, ...overrides };
}

test("sponsorLink: https only, no credentials, scheme added when missing", () => {
  assert.equal(sponsorLink("example.com/menu"), "https://example.com/menu");
  assert.equal(sponsorLink(" https://Example.com "), "https://example.com/");
  assert.equal(sponsorLink("http://example.com"), null);
  assert.equal(sponsorLink("javascript:alert(1)"), null);
  assert.equal(sponsorLink("https://user:pw@example.com"), null);
  assert.equal(sponsorLink("https://localhost"), null);
  assert.equal(sponsorLink(""), null);
  assert.equal(sponsorLink(`https://example.com/${"a".repeat(400)}`), null);
});

test("parseSponsorInput: validates every field with a sentence", () => {
  const good = parseSponsorInput({ citySlug: "Mumbai", name: "  Noor\n  Grill ", tagline: "", linkUrl: "noor.example.com" });
  assert.ok(good.ok);
  assert.deepEqual(good.ok && good.value, { citySlug: "mumbai", name: "Noor Grill", tagline: null, linkUrl: "https://noor.example.com/" });
  assert.equal(parseSponsorInput(null).ok, false);
  assert.equal(parseSponsorInput({ citySlug: "../x", name: "A", linkUrl: "a.com" }).ok, false);
  assert.equal(parseSponsorInput({ citySlug: "mumbai", name: " ", linkUrl: "a.com" }).ok, false);
  assert.equal(parseSponsorInput({ citySlug: "mumbai", name: "a".repeat(61), linkUrl: "a.com" }).ok, false);
  assert.equal(parseSponsorInput({ citySlug: "mumbai", name: "A", tagline: "t".repeat(121), linkUrl: "a.com" }).ok, false);
  const bad = parseSponsorInput({ citySlug: "mumbai", name: "A", linkUrl: "ftp://a.com" });
  assert.equal(!bad.ok && bad.error, "Add the https link people should visit.");
});

test("isLive: only active rows inside their window", () => {
  assert.equal(isLive(row(), NOW), true);
  assert.equal(isLive(row({ startsAt: NOW + 1 }), NOW), false);
  assert.equal(isLive(row({ activeUntil: NOW }), NOW), false);
  assert.equal(isLive(row({ status: "removed" }), NOW), false);
  assert.equal(isLive(row({ status: "refunded" }), NOW), false);
});

test("holdUntil: pending holds an hour; a renewing sponsor keeps a grace period", () => {
  assert.equal(holdUntil(row({ status: "pending", createdAt: NOW - 1000 }), NOW), NOW - 1000 + CHECKOUT_HOLD_MS);
  assert.equal(holdUntil(row({ status: "pending", createdAt: NOW - CHECKOUT_HOLD_MS }), NOW), null);
  assert.equal(holdUntil(row({ activeUntil: NOW - DAY }), NOW), NOW - DAY + RENEWAL_GRACE_MS);
  assert.equal(holdUntil(row({ activeUntil: NOW - DAY, renews: false }), NOW), null);
  assert.equal(holdUntil(row({ status: "removed" }), NOW), null);
});

test("cityAvailability: a paid sponsor blocks everyone, a pending checkout blocks others", () => {
  assert.deepEqual(cityAvailability([], NOW, "b"), { open: true });
  assert.deepEqual(cityAvailability([row()], NOW, "a"), { open: false, reason: "sponsored", until: NOW + 10 * DAY, renews: true });
  const pending = row({ status: "pending", createdAt: NOW - 1000, startsAt: null, activeUntil: null });
  assert.deepEqual(cityAvailability([pending], NOW, "a"), { open: true });
  assert.deepEqual(cityAvailability([pending], NOW, "b"), { open: false, reason: "held", until: NOW - 1000 + CHECKOUT_HOLD_MS });
  assert.deepEqual(cityAvailability([pending], NOW, null).open, false);
  assert.deepEqual(cityAvailability([row({ status: "refunded" }), row({ activeUntil: NOW - DAY, renews: false })], NOW, "b"), { open: true });
});

test("paidWindow: first payment starts now or after the current sponsor; renewals extend", () => {
  const pending = row({ id: "s2", status: "pending", startsAt: null, activeUntil: null });
  assert.deepEqual(paidWindow(pending, [], NOW), { startsAt: NOW, activeUntil: NOW + PERIOD });
  const current = row({ id: "s1", activeUntil: NOW + 5 * DAY });
  assert.deepEqual(paidWindow(pending, [current, pending], NOW), { startsAt: NOW + 5 * DAY, activeUntil: NOW + 5 * DAY + PERIOD });
  assert.deepEqual(paidWindow(current, [current], NOW), { startsAt: current.startsAt, activeUntil: NOW + 5 * DAY + PERIOD });
  // A late renewal after the window lapsed counts from the payment.
  const lapsed = row({ activeUntil: NOW - DAY });
  assert.deepEqual(paidWindow(lapsed, [lapsed], NOW), { startsAt: lapsed.startsAt, activeUntil: NOW + PERIOD });
});

test("parseWhopEvent: reads the events we act on and ignores the rest", () => {
  const paid = parseWhopEvent(
    {
      type: "payment.succeeded",
      timestamp: "2026-10-18T11:00:00Z",
      data: { id: "pay_1", paid_at: "2026-10-18T10:00:00Z", metadata: { sponsorship_id: "s1" }, checkout_configuration_id: "ch_1", membership: { id: "mem_1" } },
    },
    NOW,
  );
  assert.deepEqual(paid, { type: "payment.succeeded", paymentId: "pay_1", sponsorshipId: "s1", checkoutId: "ch_1", membershipId: "mem_1", paidAt: Date.parse("2026-10-18T10:00:00Z") });
  const bare = parseWhopEvent({ type: "payment.succeeded", data: { id: "pay_2" } }, NOW);
  assert.equal(bare.type === "payment.succeeded" && bare.paidAt, NOW);
  assert.deepEqual(parseWhopEvent({ type: "payment.succeeded", data: {} }, NOW), { type: "ignored", name: "payment.succeeded" });
  assert.deepEqual(parseWhopEvent({ type: "membership.deactivated", data: { id: "mem_1", metadata: {} } }, NOW), {
    type: "membership.deactivated",
    membershipId: "mem_1",
    sponsorshipId: null,
  });
  assert.deepEqual(parseWhopEvent({ type: "refund.created", data: { status: "succeeded", payment: { id: "pay_1", membership: { id: "mem_1" } } } }, NOW), {
    type: "refund",
    paymentId: "pay_1",
    membershipId: "mem_1",
  });
  assert.equal(parseWhopEvent({ type: "refund.created", data: { status: "pending", payment: { id: "pay_1" } } }, NOW).type, "ignored");
  assert.equal(parseWhopEvent({ type: "refund.updated", data: { status: "succeeded", payment: { id: "pay_1" } } }, NOW).type, "refund");
  assert.equal(parseWhopEvent({ type: "refund.created", data: {} }, NOW).type, "ignored");
  assert.deepEqual(parseWhopEvent({ type: "dispute.created" }, NOW), { type: "ignored", name: "dispute.created" });
  assert.deepEqual(parseWhopEvent("nonsense", NOW), { type: "ignored", name: "unknown" });
});
