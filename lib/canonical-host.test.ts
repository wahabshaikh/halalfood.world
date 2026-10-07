import assert from "node:assert/strict";
import { test } from "vitest";
import { canonicalRedirect } from "./canonical-host";

test("www redirects to the apex with path and query, including the API", () => {
  for (const path of ["/cities?x=1", "/api/places?bbox=1,2,3,4"]) {
    const response = canonicalRedirect(new Request(`https://www.halalfood.world${path}`));
    assert.equal(response?.status, 308);
    assert.equal(response?.headers.get("location"), `https://halalfood.world${path}`);
  }
});

test("the apex and every other host are served as is", () => {
  for (const url of ["https://halalfood.world/", "http://127.0.0.1:5173/", "https://b-halalfood-world.x.workers.dev/"]) {
    assert.equal(canonicalRedirect(new Request(url)), null);
  }
});
