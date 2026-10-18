import { afterEach, test } from "vitest";
import assert from "node:assert/strict";
import { env } from "@/lib/testing/cloudflare-workers";
import { addProfile, addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";
import { parseSponsorInput } from "@/lib/core/sponsorship";
import { liveSponsor, startSponsorship } from "@/lib/sponsorships";
import { signWhopWebhook } from "@/lib/whop";
import { POST } from "@/app/api/webhooks/whop/route";

const SECRET = "ws_route_test_secret";

afterEach(() => {
  delete env.DB;
  delete env.WHOP_WEBHOOK_SECRET;
});

async function delivery(body: unknown, id = "msg_route_1", secret = SECRET) {
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  return new Request("https://halalfood.world/api/webhooks/whop", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": await signWhopWebhook(payload, id, timestamp, secret),
    },
    body: payload,
  });
}

test("the Whop webhook route is closed until its secret is set", async () => {
  const response = await POST(await delivery({ type: "payment.succeeded" }));
  assert.equal(response.status, 503);
});

test("the Whop webhook route rejects a bad signature and activates a paid sponsorship once", async () => {
  const { sqlite, binding, db } = createTestDatabase();
  addUser(sqlite, "a");
  addProfile(sqlite, "a");
  env.DB = binding;
  env.WHOP_WEBHOOK_SECRET = SECRET;
  const parsed = parseSponsorInput({ citySlug: "london", name: "Seed Sponsor", linkUrl: "https://sponsor.example.com" });
  assert.ok(parsed.ok);
  const started = await startSponsorship("a", parsed.ok ? parsed.value : (null as never), db);
  assert.ok(started.ok);
  const id = started.ok ? started.id : "";
  const event = { type: "payment.succeeded", data: { id: "pay_1", metadata: { sponsorship_id: id }, membership: { id: "mem_1" } } };

  assert.equal((await POST(await delivery(event, "msg_bad", "ws_wrong"))).status, 401);
  assert.equal(await liveSponsor("london", db), null);

  assert.equal((await POST(await delivery(event))).status, 200);
  assert.equal((await liveSponsor("london", db))?.name, "Seed Sponsor");
  // Whop retries the same delivery: still 200, still one row of history.
  assert.equal((await POST(await delivery(event))).status, 200);
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM whop_webhook_events`).get() as { n: number }).n, 1);
});
