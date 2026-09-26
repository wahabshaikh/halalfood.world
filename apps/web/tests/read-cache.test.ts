import assert from "node:assert/strict";
import test from "node:test";

import { cachedRead, clearReadCache } from "../src/lib/read-cache";

test("reuses a loaded value within its TTL", async () => {
  clearReadCache();
  let loads = 0;
  const load = async () => ++loads;

  assert.equal(await cachedRead("reuse", 60, load), 1);
  assert.equal(await cachedRead("reuse", 60, load), 1);
  assert.equal(loads, 1);
});

test("collapses concurrent identical reads into one load", async () => {
  clearReadCache();
  let loads = 0;
  const load = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return "rows";
  };

  const results = await Promise.all([
    cachedRead("concurrent", 60, load),
    cachedRead("concurrent", 60, load),
    cachedRead("concurrent", 60, load),
  ]);
  assert.deepEqual(results, ["rows", "rows", "rows"]);
  assert.equal(loads, 1);
});

test("keeps keys independent", async () => {
  clearReadCache();
  assert.equal(await cachedRead("a", 60, async () => "a"), "a");
  assert.equal(await cachedRead("b", 60, async () => "b"), "b");
});

test("never caches a failed load", async () => {
  clearReadCache();
  let loads = 0;
  const failing = async () => {
    loads += 1;
    throw new Error("D1 unavailable");
  };

  await assert.rejects(cachedRead("failure", 60, failing));
  // Give the rejection handler a turn to evict the entry.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await cachedRead("failure", 60, async () => "recovered"), "recovered");
  assert.equal(loads, 1);
});

test("reloads once the TTL has passed", async () => {
  clearReadCache();
  let loads = 0;
  const load = async () => ++loads;

  assert.equal(await cachedRead("expiry", 0, load), 1);
  assert.equal(await cachedRead("expiry", 0, load), 2);
});
