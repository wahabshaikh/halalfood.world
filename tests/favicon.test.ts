import assert from "node:assert/strict";
import { test } from "vitest";
import { GET } from "@/app/favicon.ico/route";

test("GET /favicon.ico permanently redirects to the site icon with a one-day cache", () => {
  const response = GET();

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("Location"), "/favicon-32.png");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=86400");
});
