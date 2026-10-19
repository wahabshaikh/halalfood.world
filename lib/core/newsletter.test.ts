import { test } from "vitest";
import assert from "node:assert/strict";
import { grantsNewsletterAccess, parseNewsletterEvent } from "./newsletter";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const config = { planId: "plan_news", productId: "prod_news" };
const event = (extra = {}, type = "membership.activated") => ({ type, timestamp: "2026-10-18T11:00:00Z", data: {
  id: "mem_1", user_id: "user_whop", plan_id: "plan_news", product_id: "prod_news", status: "active",
  cancel_at_period_end: false, current_period_end: "2026-11-18T12:00:00Z", manage_url: "https://whop.com/manage/mem_1",
  metadata: { kind: "newsletter", user_id: "local" }, ...extra,
} });

test("newsletter access statuses include cancellation at period end and payment retries", () => {
  for (const status of ["active", "trialing", "canceling", "past_due"]) assert.equal(grantsNewsletterAccess(status), true);
  for (const status of ["completed", "canceled", "expired", "unresolved", "drafted", "unknown"]) assert.equal(grantsNewsletterAccess(status), false);
});

test("newsletter membership events preserve ids, local ownership, timestamps and billing state", () => {
  for (const type of ["membership.activated", "membership.updated", "membership.deactivated", "membership.cancel_at_period_end_changed"]) {
    assert.deepEqual(parseNewsletterEvent(event({}, type), config, NOW), {
      id: "mem_1", userId: "local", whopUserId: "user_whop", productId: "prod_news", planId: "plan_news", status: "active",
      cancelAtPeriodEnd: false, currentPeriodEnd: Date.parse("2026-11-18T12:00:00Z"), manageUrl: "https://whop.com/manage/mem_1", eventAt: NOW - 3600000,
    });
  }
});

test("newsletter recognition requires its kind, product or plan; malformed events are ignored", () => {
  assert.equal(parseNewsletterEvent(event({ metadata: {}, product_id: "prod_other", plan_id: "plan_other" }), config, NOW), null);
  for (const extra of [{ metadata: {} }, { metadata: {}, product_id: "prod_other" }, { metadata: {}, plan_id: "plan_other" }])
    assert.ok(parseNewsletterEvent(event(extra), config, NOW));
  assert.ok(parseNewsletterEvent(event({ plan_id: "plan_other", product_id: "prod_other" }), {}, NOW));
  assert.equal(parseNewsletterEvent(event({ metadata: {}, plan_id: null, product_id: null }), {}, NOW), null);
  for (const body of [null, "bad", {}, event({}, "payment.succeeded"), event({ id: "" }), event({ status: null })])
    assert.equal(parseNewsletterEvent(body, config, NOW), null);
  const parsed = parseNewsletterEvent({ ...event({ metadata: null, user_id: null, current_period_end: "bad", manage_url: "javascript:alert(1)" }), timestamp: "bad" }, config, NOW);
  assert.equal(parsed?.userId, null);
  assert.equal(parsed?.whopUserId, null);
  assert.equal(parsed?.currentPeriodEnd, null);
  assert.equal(parsed?.manageUrl, null);
  assert.equal(parsed?.eventAt, NOW);
});
