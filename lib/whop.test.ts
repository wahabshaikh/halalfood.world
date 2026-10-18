import { afterEach, test } from "vitest";
import { env } from "@/lib/testing/cloudflare-workers";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SPONSOR_PERIOD_DAYS, SPONSOR_PRICE_USD } from "@/lib/core/sponsorship";
import { WEBHOOK_TOLERANCE_MS, checkWhopAccess, createNewsletterCheckout, newsletterConfig, whopConfig, createSponsorCheckout, signWhopWebhook, verifyWhopWebhook } from "./whop";

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
  assert.deepEqual(body.metadata, { kind: "sponsorship", sponsorship_id: "s1", city_slug: "mumbai" });
  assert.equal(body.account_id, "biz_1");
  assert.equal(body.plan.account_id, "biz_1");
  assert.equal(body.plan.company_id, undefined);
  assert.equal(body.plan.product, undefined);
  assert.equal(body.plan.visibility, "hidden");
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


afterEach(() => {
  for (const key of ["WHOP_API_KEY", "WHOP_COMPANY_ID", "WHOP_SPONSOR_PRODUCT_ID", "WHOP_NEWSLETTER_PLAN_ID", "WHOP_NEWSLETTER_PRODUCT_ID"]) delete env[key];
});

test("Whop configuration reads optional sponsor product and requires a newsletter plan", async () => {
  assert.equal(await whopConfig(), null);
  assert.equal(await newsletterConfig(), null);
  env.WHOP_API_KEY = "key";
  env.WHOP_COMPANY_ID = "biz_1";
  env.WHOP_SPONSOR_PRODUCT_ID = "prod_sponsor";
  assert.deepEqual(await whopConfig(), { apiKey: "key", companyId: "biz_1", sponsorProductId: "prod_sponsor" });
  env.WHOP_NEWSLETTER_PLAN_ID = "plan_news";
  assert.deepEqual(await newsletterConfig(), { apiKey: "key", planId: "plan_news", productId: undefined });
  env.WHOP_NEWSLETTER_PRODUCT_ID = "prod_news";
  assert.deepEqual(await newsletterConfig(), { apiKey: "key", planId: "plan_news", productId: "prod_news" });
});

test("sponsor checkout optionally reuses its configured product", async () => {
  await createSponsorCheckout({ apiKey: "key", companyId: "biz_1", sponsorProductId: "prod_sponsor" },
    { sponsorshipId: "s1", citySlug: "mumbai", cityLabel: "Mumbai", redirectUrl: "https://x.test/" },
    (async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).plan.product_id, "prod_sponsor");
      return Response.json({ id: "ch_1", purchase_url: "https://whop.com/pay" });
    }) as typeof fetch);
});

test("newsletter checkout uses an existing plan with local ownership and an idempotency key", async () => {
  const result = await createNewsletterCheckout({ apiKey: "key" }, { userId: "a", redirectUrl: "https://halalfood.world/newsletter", planId: "plan_news" },
    (async (url, init) => {
      assert.equal(url, "https://api.whop.com/api/v1/checkout_configurations");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer key");
      assert.ok(headers["Idempotency-Key"]);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        mode: "payment", plan_id: "plan_news", metadata: { kind: "newsletter", user_id: "a" }, redirect_url: "https://halalfood.world/newsletter",
      });
      return Response.json({ id: "ch_news", purchase_url: "/checkout/news" });
    }) as typeof fetch);
  assert.deepEqual(result, { id: "ch_news", purchaseUrl: "https://whop.com/checkout/news" });
  for (const response of [new Response("no", { status: 401 }), Response.json({ id: "ch_news" })])
    await assert.rejects(createNewsletterCheckout({ apiKey: "key" }, { userId: "a", planId: "plan_news", redirectUrl: "https://x.test" }, (async () => response) as typeof fetch));
});

test("Whop access calls the user/resource endpoint with a three-second timeout", async () => {
  for (const access of [true, false]) {
    assert.equal(await checkWhopAccess({ apiKey: "key" }, "user_1", "prod_news", (async (url, init) => {
      assert.equal(url, "https://api.whop.com/api/v1/users/user_1/access/prod_news");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer key");
      assert.ok(init?.signal);
      return Response.json({ has_access: access, access_level: access ? "customer" : "no_access" });
    }) as typeof fetch), access);
  }
  for (const response of [new Response("no", { status: 403 }), Response.json({})])
    await assert.rejects(checkWhopAccess({ apiKey: "key" }, "user_1", "prod_news", (async () => response) as typeof fetch));
});
