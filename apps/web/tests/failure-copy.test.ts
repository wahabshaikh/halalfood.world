import assert from "node:assert/strict";
import { test } from "node:test";
import {
  failureCopy,
  failureKindFromError,
  formatFailure,
  presentFetchFailure,
  presentHttpFailure,
  presentTransportFailure,
} from "../src/lib/failure-copy";

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
    presentFetchFailure("Places", new Response("no", { status: 403 }), null),
    presentFetchFailure("Places", new Response("no", { status: 404 }), null),
    presentFetchFailure("Places", new Response("no", { status: 429 }), null),
    presentFetchFailure("Places", null, offline),
  ]);
  const messages = presented.map((item) => item.message);
  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) {
    assert.equal(message.includes("Failed to fetch"), false);
    assert.match(message, /Reference [a-z0-9-]{4,16}\./i);
  }
  assert.match(messages[0], /cannot open/i);
  assert.match(messages[1], /not here/i);
  assert.match(messages[2], /rate limited/i);
  assert.match(messages[3], /offline/i);
  assert.equal(presented[0].retry, false);
  assert.equal(presented[1].retry, false);
  assert.equal(presented[2].retry, true);
  assert.equal(presented[3].retry, true);
  assert.match(formatFailure(503, "Places", "abcd1234"), /Reference abcd1234/);
});

test("map HTTP errors keep the server message and fetch failures never show Failed to fetch", () => {
  const http = presentHttpFailure("Places", 503, "Places are temporarily unavailable. Please try again.");
  assert.match(
    http.message,
    /^Places are temporarily unavailable\. Please try again\. Reference [a-z0-9-]{4,16}\.$/,
  );
  assert.equal(http.retry, true);

  const forbidden = presentHttpFailure("Places", 403, "This area is not available to this account");
  assert.match(
    forbidden.message,
    /^This area is not available to this account\. Reference [a-z0-9-]{4,16}\.$/,
  );
  assert.equal(forbidden.retry, false);

  const missing = presentHttpFailure("Places", 404, "");
  assert.match(missing.message, /not here/i);
  assert.match(missing.message, /Reference [a-z0-9-]{4,16}\./);
  assert.equal(missing.message.includes("Failed to fetch"), false);

  for (const raw of ["Failed to fetch", "Load failed"]) {
    const transport = presentTransportFailure("Places", new TypeError(raw));
    assert.match(transport.message, /offline/i);
    assert.equal(transport.message.includes(raw), false);
    assert.equal(transport.retry, true);
    const echoed = presentHttpFailure("Places", 503, raw);
    assert.equal(echoed.message.includes(raw), false);
  }
});
