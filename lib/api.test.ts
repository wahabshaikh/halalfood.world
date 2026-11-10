import assert from "node:assert/strict";
import { test } from "vitest";
import { BODY_TOO_LARGE, INVALID_JSON, readBoundedJson } from "./api";

test("readBoundedJson accepts a small object and rejects oversized or broken bodies", async () => {
  const ok = await readBoundedJson(new Request("https://halalfood.world/api/owner-claims", { method: "POST", body: JSON.stringify({ placeId: "x" }) }));
  assert.deepEqual(ok, { placeId: "x" });
  const header = await readBoundedJson(new Request("https://halalfood.world/api/owner-claims", { method: "POST", headers: { "content-length": "999" }, body: "{}" }), 10);
  assert.equal(header, BODY_TOO_LARGE);
  const fat = await readBoundedJson(new Request("https://halalfood.world/api/owner-claims", { method: "POST", body: JSON.stringify({ note: "x".repeat(50) }) }), 20);
  assert.equal(fat, BODY_TOO_LARGE);
  const broken = await readBoundedJson(new Request("https://halalfood.world/api/owner-claims", { method: "POST", body: "not-json" }));
  assert.equal(broken, INVALID_JSON);
});