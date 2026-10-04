import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_FILTERS, type DiscoveryFilters } from "@halalfood/core/discovery-filters";
import {
  MAX_AUTO_RETRIES,
  backoffMs,
  retryAfterMs,
  retryDecision,
} from "../src/lib/fetch-retry";
import { unauthorizedFallback } from "../src/lib/map-loading";

type MapState = { filters: DiscoveryFilters; signedIn: boolean };

/**
 * React re-runs an effect when any dependency changed by `Object.is`, and a
 * setState with an identical value does not re-render. This replays that for
 * the map's viewport effect (deps: filters, signedIn) against a server that
 * always answers 401, and counts requests. A loop hits the render cap.
 */
function requestsUntilSettled(
  start: MapState,
  on401: (state: MapState) => Partial<MapState>,
  cap = 200,
): number {
  let state = start;
  let deps: unknown[] | null = null;
  let requests = 0;
  for (let render = 0; render < cap; render++) {
    const next = [state.filters, state.signedIn];
    if (deps && next.every((value, index) => Object.is(value, deps![index]))) return requests;
    deps = next;
    requests++; // the effect fetches /api/discover and gets 401
    state = { ...state, ...on401(state) };
  }
  return requests;
}

const fixed = (state: MapState) => {
  const fallback = unauthorizedFallback(state);
  return fallback.personal ? { filters: fallback.filters, signedIn: fallback.signedIn } : {};
};

test("a persistent 401 on the map settles instead of looping", () => {
  assert.equal(requestsUntilSettled({ filters: EMPTY_FILTERS, signedIn: false }, fixed), 1);
  assert.equal(requestsUntilSettled({ filters: EMPTY_FILTERS, signedIn: true }, fixed), 2);
  assert.equal(
    requestsUntilSettled({ filters: { ...EMPTY_FILTERS, whose: "friends" }, signedIn: true }, fixed),
    2,
  );
});

test("the harness catches the old 401 handler's loop", () => {
  // What 8a7e16e did: a fresh filters object on every 401.
  const legacy = (state: MapState) => ({
    filters: { ...state.filters, whose: "everyone" as const },
    signedIn: false,
  });
  assert.equal(requestsUntilSettled({ filters: EMPTY_FILTERS, signedIn: false }, legacy), 200);
});

test("unauthorizedFallback keeps the same filters object when nothing changes", () => {
  const filters = { ...EMPTY_FILTERS };
  assert.equal(unauthorizedFallback({ filters, signedIn: false }).filters, filters);
  assert.equal(unauthorizedFallback({ filters, signedIn: false }).personal, false);
  const mine = { ...EMPTY_FILTERS, whose: "mine" as const };
  const out = unauthorizedFallback({ filters: mine, signedIn: false });
  assert.equal(out.personal, true);
  assert.equal(out.filters.whose, "everyone");
});

test("401 and 403 never retry on their own; other client errors neither", () => {
  assert.deepEqual(retryDecision(401, 0), { auto: false, reason: "sign-in" });
  assert.deepEqual(retryDecision(403, 0), { auto: false, reason: "forbidden" });
  assert.deepEqual(retryDecision(404, 0), { auto: false, reason: "client" });
  assert.deepEqual(retryDecision(400, 0), { auto: false, reason: "client" });
});

test("5xx, 429 and network failures back off and stop after a few tries", () => {
  const random = () => 1;
  const delays: number[] = [];
  let attempt = 0;
  for (;;) {
    const decision = retryDecision(503, attempt, { random });
    if (!decision.auto) {
      assert.equal(decision.reason, "exhausted");
      break;
    }
    delays.push(decision.delayMs);
    attempt++;
    assert.ok(attempt <= 10, "retries must be bounded");
  }
  assert.equal(delays.length, MAX_AUTO_RETRIES);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(retryDecision("network", 0, { random }).auto, true);
  const limited = retryDecision(429, 0, { retryAfter: "7" });
  assert.deepEqual(limited, { auto: true, delayMs: 7000 });
  assert.equal(backoffMs(20, () => 1), 30_000);
  assert.equal(retryAfterMs("not a date"), null);
  assert.ok(backoffMs(2, () => 0) >= 3000 && backoffMs(2, () => 0) <= 4000);
});
