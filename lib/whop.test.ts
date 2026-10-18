import { test } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SPONSOR_PERIOD_DAYS, SPONSOR_PRICE_USD } from "@/lib/core/sponsorship";
import { WEBHOOK_TOLERANCE_MS, createSponsorCheckout, signWhopWebhook, verifyWhopWebhook } from "./whop";

const SECRET = "ws_test_secret_value";
const NOW = Date.parse("2026-10-18T12:00:00Z");
const TS = Math.floor(NOW / 1000);

function headers(values: Record<string, string>) {
  return new Headers(values);
}

test("signWhopWebhook matches HMAC-SHA256 over id.timestamp.body keyed with the literal secret", async () => {
  const body = JSON.stringify({ type: "payment.succeeded" });
  const expected = createHmac("sha256", SECRET).update(`msg_1.${TS}.${body}`).digest("base64");
  assert.equal(await signWhopWebhook(body, "msg_1", TS, SECRET), `v1,${expected}`);
});

test("verifyWhopWebhook accepts a good signature, also among several", async () => {
  const body = JSON.stringify({ type: "payment.succeeded", data: { id: "pay_1" } });
  const signature = await signWhopWebhook(body, "msg_1", TS, SECRET);
  const verified = await verifyWhopWebhook(body, headers({ "webhook-id": "msg_1", "webhook-timestamp": String(TS), "webhook-signature": signature }), SECRET, NOW);
  assert.deepEqual(verified, { id: "msg_1", body: { type: "payment.succeeded", data: { id: "pay_1" } } });
  const rotated = await verifyWhopWebhook(
    body,
    headers({ "webhook-id": "msg_1", "webhook-timestamp": String(TS), "webhook-signature": `v1,AAAA ${signature}` }),
    SECRET,
    NOW,
  );
  assert.ok(rotated);
});

test("verifyWhopWebhook rejects tampering, replays, missing headers and a missing secret", async () => {
  const body = JSON.stringify({ type: "payment.succeeded" });
  const signature = await signWhopWebhook(body, "msg_1", TS, SECRET);
  const good = { "webhook-id": "msg_1", "webhook-timestamp": String(TS), "webhook-signature": signature };
  assert.equal(await verifyWhopWebhook(`${body} `, headers(good), SECRET, NOW), null);
  assert.equal(await verifyWhopWebhook(body, headers({ ...good, "webhook-id": "msg_2" }), SECRET, NOW), null);
  assert.equal(await verifyWhopWebhook(body, headers(good), "ws_other", NOW), null);
  assert.equal(await verifyWhopWebhook(body, headers(good), "", NOW), null);
  assert.equal(await verifyWhopWebhook(body, headers(good), SECRET, NOW + WEBHOOK_TOLERANCE_MS + 1000), null);
  assert.equal(await verifyWhopWebhook(body, headers({ ...good, "webhook-timestamp": "soon" }), SECRET, NOW), null);
  assert.equal(await verifyWhopWebhook(body, headers({ "webhook-id": "msg_1", "webhook-timestamp": String(TS) }), SECRET, NOW), null);
  const notJson = "not json";
  const notJsonSig = await signWhopWebhook(notJson, "msg_1", TS, SECRET);
  assert.equal(await verifyWhopWebhook(notJson, headers({ ...good, "webhook-signature": notJsonSig }), SECRET, NOW), null);
});

test("createSponsorCheckout sends a monthly plan with the sponsorship id and returns an absolute purchase URL", async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const fetcher = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return Response.json({ id: "ch_1", purchase_url: "/checkout/ch_1/" });
  }) as unknown as typeof fetch;
  const result = await createSponsorCheckout(
    { apiKey: "key", companyId: "biz_1" },
    { sponsorshipId: "s1", citySlug: "mumbai", cityLabel: "Mumbai", redirectUrl: "https://halalfood.world/sponsor/thanks?id=s1" },
    fetcher,
  );
  assert.deepEqual(result, { id: "ch_1", purchaseUrl: "https://whop.com/checkout/ch_1/" });
  assert.ok(sent);
  const { url, init } = sent as { url: string; init: RequestInit };
  assert.equal(url, "https://api.whop.com/api/v1/checkout_configurations");
  const requestHeaders = init.headers as Record<string, string>;
  assert.equal(requestHeaders.Authorization, "Bearer key");
  assert.equal(requestHeaders["Idempotency-Key"], "s1");
  const body = JSON.parse(String(init.body));
  assert.deepEqual(body.metadata, { sponsorship_id: "s1", city_slug: "mumbai" });
  assert.equal(body.plan.company_id, "biz_1");
  assert.equal(body.plan.plan_type, "renewal");
  assert.equal(body.plan.initial_price, SPONSOR_PRICE_USD);
  assert.equal(body.plan.renewal_price, SPONSOR_PRICE_USD);
  assert.equal(body.plan.billing_period, SPONSOR_PERIOD_DAYS);
  assert.equal(body.redirect_url, "https://halalfood.world/sponsor/thanks?id=s1");
});

test("createSponsorCheckout throws on a Whop error or an incomplete response", async () => {
  const config = { apiKey: "key", companyId: "biz_1" };
  const request = { sponsorshipId: "s1", citySlug: "mumbai", cityLabel: "Mumbai", redirectUrl: "https://x.test/" };
  await assert.rejects(createSponsorCheckout(config, request, (async () => new Response("no", { status: 401 })) as unknown as typeof fetch));
  await assert.rejects(createSponsorCheckout(config, request, (async () => Response.json({ id: "ch_1" })) as unknown as typeof fetch));
});
