/**
 * The same Whop events in both payload shapes the webhook can receive (docs.whop.com/developer/guides/webhooks,
 * "Events and versions"): `legacy` is what an unpinned webhook sends (any created in the dashboard), `pinned` is
 * a webhook pinned to api_version_date 2026-10-15-1. Field names follow the legacy and native Retrieve
 * payment / membership / refund schemas. Every event must parse to the same result in both.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseWhopEvent } from "./sponsorship";
import { parseNewsletterEvent } from "./newsletter";

const NOW = Date.parse("2026-10-19T02:00:00Z");
const PERIOD_END = "2026-11-18T02:00:00.000Z";
const envelope = (type: string, data: Record<string, unknown>, shape: "legacy" | "pinned") => ({
  id: "msg_1", api_version: "v1", type, timestamp: "2026-10-19T01:00:00.000Z", data,
  ...(shape === "legacy" ? { company_id: "biz_hf" } : { account_id: "biz_hf", api_version_date: "2026-10-15-1" }),
});

const payment = {
  legacy: (metadata: Record<string, unknown>) => ({
    id: "pay_1", status: "paid", paid_at: "2026-10-19T00:30:00.000Z", checkout_configuration_id: "ch_1", metadata,
    membership: { id: "mem_1", status: "active" }, plan: { id: "plan_s" }, product: { id: "prod_s" }, user: { id: "user_w" },
    company: { id: "biz_hf" }, refunds: [],
  }),
  pinned: (metadata: Record<string, unknown>) => ({
    id: "pay_1", status: "paid", paid_at: "2026-10-19T00:30:00.000Z", checkout_configuration_id: "ch_1", metadata,
    membership_id: "mem_1", plan_id: "plan_s", product_id: "prod_s", user: { id: "user_w" }, account_id: "biz_hf",
  }),
};

const membership = {
  legacy: (extra: Record<string, unknown>) => ({
    id: "mem_1", status: "active", cancel_at_period_end: false, renewal_period_end: PERIOD_END,
    manage_url: "https://whop.com/billing/manage/mem_1", product: { id: "prod_news", title: "halalfood.world Newsletter" },
    plan: { id: "plan_news" }, user: { id: "user_w", username: "w" }, company: { id: "biz_hf" }, ...extra,
  }),
  pinned: (extra: Record<string, unknown>) => ({
    id: "mem_1", status: "active", cancel_at_period_end: false, current_period_end: PERIOD_END,
    manage_url: "https://whop.com/billing/manage/mem_1", product_id: "prod_news", product: { id: "prod_news" },
    plan_id: "plan_news", user_id: "user_w", account: { id: "biz_hf" }, ...extra,
  }),
};

const refund = {
  legacy: (status: string) => ({ id: "rfnd_1", status, amount: 49, currency: "usd", payment: { id: "pay_1", membership: { id: "mem_1" } } }),
  pinned: (status: string) => ({ id: "rfnd_1", status, amount: { amount: "49.00", currency: "usd" }, payment_id: "pay_1", account_id: "biz_hf" }),
};

const MEMBERSHIP_EVENTS = ["membership.activated", "membership.updated", "membership.deactivated", "membership.cancel_at_period_end_changed"];

for (const shape of ["legacy", "pinned"] as const) {
  test(`${shape} payment.succeeded: sponsorship payment parsed, newsletter payment ignored`, () => {
    assert.deepEqual(parseWhopEvent(envelope("payment.succeeded", payment[shape]({ kind: "sponsorship", sponsorship_id: "s1" }), shape), NOW), {
      type: "payment.succeeded", paymentId: "pay_1", sponsorshipId: "s1", checkoutId: "ch_1", membershipId: "mem_1",
      paidAt: Date.parse("2026-10-19T00:30:00.000Z"),
    });
    assert.equal(parseWhopEvent(envelope("payment.succeeded", payment[shape]({ kind: "newsletter" }), shape), NOW).type, "ignored");
  });

  test(`${shape} membership events: sponsorship stop and resume`, () => {
    const sponsor = { metadata: { kind: "sponsorship", sponsorship_id: "s1" } };
    for (const type of MEMBERSHIP_EVENTS) {
      const stopped = parseWhopEvent(envelope(type, membership[shape]({ ...sponsor, status: "canceled" }), shape), NOW);
      assert.deepEqual(stopped, { type: "membership.deactivated", membershipId: "mem_1", sponsorshipId: "s1" });
      const canceling = parseWhopEvent(envelope(type, membership[shape]({ ...sponsor, status: "canceling", cancel_at_period_end: true }), shape), NOW);
      assert.equal(canceling.type, "membership.deactivated");
    }
    const resumed = parseWhopEvent(envelope("membership.cancel_at_period_end_changed", membership[shape](sponsor), shape), NOW);
    assert.deepEqual(resumed, { type: "membership.renewing", membershipId: "mem_1", sponsorshipId: "s1" });
  });

  test(`${shape} membership events: newsletter matched by product or plan, with ids and period end`, () => {
    for (const type of MEMBERSHIP_EVENTS) {
      for (const config of [{ productId: "prod_news" }, { planId: "plan_news" }]) {
        assert.deepEqual(parseNewsletterEvent(envelope(type, membership[shape]({ metadata: null }), shape), config, NOW), {
          id: "mem_1", userId: null, whopUserId: "user_w", productId: "prod_news", planId: "plan_news", status: "active",
          cancelAtPeriodEnd: false, currentPeriodEnd: Date.parse(PERIOD_END), manageUrl: "https://whop.com/billing/manage/mem_1",
          eventAt: Date.parse("2026-10-19T01:00:00.000Z"),
        });
      }
      // Newsletter memberships never reach the sponsorship handler.
      assert.equal(parseWhopEvent(envelope(type, membership[shape]({ metadata: { kind: "newsletter" }, status: "canceled" }), shape), NOW).type, "ignored");
    }
    assert.equal(parseNewsletterEvent(envelope("membership.updated", membership[shape]({ metadata: null }), shape), { productId: "prod_other" }, NOW), null);
  });

  test(`${shape} refund.created / refund.updated: act once succeeded`, () => {
    for (const type of ["refund.created", "refund.updated"]) {
      assert.equal(parseWhopEvent(envelope(type, refund[shape]("pending"), shape), NOW).type, "ignored");
      const done = parseWhopEvent(envelope(type, refund[shape]("succeeded"), shape), NOW);
      assert.deepEqual(done, { type: "refund", paymentId: "pay_1", membershipId: shape === "legacy" ? "mem_1" : null });
    }
  });
}
