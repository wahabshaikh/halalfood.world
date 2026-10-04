import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  failureCopy,
  failureKindFromError,
  formatFailure,
  presentFetchFailure,
  presentHttpFailure,
  presentTransportFailure,
  type FailureKind,
} from "../src/lib/failure-copy";

const RAW_FETCH = ["Failed to fetch", "Load failed"] as const;

test("each failure kind has its own copy and does not pretend the data is empty", () => {
  const cases = [401, 403, 404, 429, 503, "offline"] as const;
  const titles = cases.map((kind) => failureCopy(kind, "Your feed").title);
  assert.equal(new Set(titles).size, titles.length);
  for (const kind of cases) {
    const copy = failureCopy(kind, "Your feed");
    assert.match(copy.detail, /Nothing|nothing/);
    assert.equal(copy.title.toLowerCase().includes("no results"), false);
  }
  assert.equal(failureCopy(503, "Your feed").retry, true);
  assert.equal(failureCopy(401, "Your feed").retry, false);
  assert.match(failureCopy(503, "Your profile").title, /Your profile/);
});

test("403, 404, 429 and offline each have their own copy and never echo Failed to fetch", async () => {
  const offline = new TypeError("Failed to fetch");
  assert.equal(failureKindFromError(offline), "offline");
  assert.equal(failureKindFromError(new Error("Places couldn’t load.")), 503);

  const presented = await Promise.all([
    presentFetchFailure("places", new Response("no", { status: 403 }), null),
    presentFetchFailure("places", new Response("no", { status: 404 }), null),
    presentFetchFailure("places", new Response("no", { status: 429 }), null),
    presentFetchFailure("places", null, offline),
  ]);
  const messages = presented.map((item) => item.message);
  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) {
    assert.equal(message.includes("Failed to fetch"), false);
    assert.match(message, /Reference [a-z0-9-]{4,16}\./i);
  }
  assert.match(messages[0], /cannot open/i);
  assert.match(messages[1], /couldn’t find places/i);
  assert.match(messages[2], /rate limited/i);
  assert.match(messages[3], /offline/i);
  assert.equal(/\bplaces is\b/i.test(messages.join(" ")), false);
  assert.equal(presented[0].retry, false);
  assert.equal(presented[1].retry, false);
  assert.equal(presented[2].retry, true);
  assert.equal(presented[3].retry, true);
  assert.match(formatFailure(503, "places", "abcd1234"), /We couldn’t load places\./);
  assert.match(formatFailure(503, "places", "abcd1234"), /Reference abcd1234/);
});

test("map HTTP errors keep the server message and fetch failures never show Failed to fetch", () => {
  const http = presentHttpFailure("places", 503, "Places are temporarily unavailable. Please try again.");
  assert.match(
    http.message,
    /^Places are temporarily unavailable\. Please try again\. Reference [a-z0-9-]{4,16}\.$/,
  );
  assert.equal(http.retry, true);

  const forbidden = presentHttpFailure("places", 403, "This area is not available to this account");
  assert.match(
    forbidden.message,
    /^This area is not available to this account\. Reference [a-z0-9-]{4,16}\.$/,
  );
  assert.equal(forbidden.retry, false);

  const missing = presentHttpFailure("places", 404, "");
  assert.match(missing.message, /We couldn’t find places\./);
  assert.match(missing.message, /Reference [a-z0-9-]{4,16}\./);
  assert.equal(missing.message.includes("Failed to fetch"), false);

  for (const raw of RAW_FETCH) {
    const transport = presentTransportFailure("places", new TypeError(raw));
    assert.match(transport.message, /offline/i);
    assert.equal(transport.message.includes(raw), false);
    assert.equal(transport.retry, true);
    const echoed = presentHttpFailure("places", 503, raw);
    assert.equal(echoed.message.includes(raw), false);
  }
});

test("plural subjects read without a singular verb", () => {
  assert.equal(failureCopy(404, "places").title, "We couldn’t find places.");
  assert.equal(failureCopy(429, "places").title, "Requests for places are rate limited.");
  assert.equal(failureCopy(503, "places").title, "We couldn’t load places.");
  assert.match(failureCopy("offline", "places").detail, /^We couldn’t reach places\./);
  for (const kind of [401, 403, 404, 429, 503, "offline"] as const satisfies readonly FailureKind[]) {
    const copy = failureCopy(kind, "places");
    const text = `${copy.title} ${copy.detail}`;
    assert.equal(/\bplaces is\b/i.test(text), false);
    for (const raw of RAW_FETCH) assert.equal(text.includes(raw), false);
  }
});

test("Failed to fetch and Load failed never render for the screens outside the map", () => {
  const domains = ["places", "your RSVP", "this rec", "this event", "your feed"];
  const statuses = [400, 401, 403, 404, 429, 500, 503];
  for (const domain of domains) {
    for (const raw of RAW_FETCH) {
      for (const status of statuses) {
        const http = presentHttpFailure(domain, status, raw);
        assert.equal(http.message.includes(raw), false, `${domain} ${status} ${raw}`);
        assert.equal(/failed to fetch|load failed/i.test(http.message), false);
      }
      const transport = presentTransportFailure(domain, new TypeError(raw));
      assert.equal(transport.message.includes(raw), false);
      assert.equal(/failed to fetch|load failed/i.test(transport.message), false);
      assert.equal(transport.retry, true);
      const denied = presentHttpFailure(domain, 403, "");
      assert.equal(denied.retry, false);
      assert.equal(/failed to fetch|load failed/i.test(denied.message), false);
    }
  }

  const screens = [
    "../app/event/[id]/event-going.tsx",
    "../app/send/send-view.tsx",
    "../app/admin/events-admin.tsx",
    "../app/map/map-view.tsx",
  ];
  for (const screen of screens) {
    const source = readFileSync(new URL(screen, import.meta.url), "utf8");
    assert.equal(source.includes("(caught as Error).message"), false, screen);
    assert.equal(source.includes("Failed to fetch"), false, screen);
    assert.equal(source.includes("Load failed"), false, screen);
  }
});
