import assert from "node:assert/strict";
import { test } from "vitest";
import { placePageId, withPlaceRobotsHeader } from "./robots-header";

const ID = "00000000-0000-4000-8000-000000000010";
const html = () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const request = (path: string, method = "GET") => new Request(`https://halalfood.world${path}`, { method });

test("only place pages are looked up", () => {
  assert.equal(placePageId(request(`/place/${ID}`)), ID);
  assert.equal(placePageId(request(`/place/${ID}/`)), ID);
  assert.equal(placePageId(request(`/place/${ID.toUpperCase()}`)), ID);
  assert.equal(placePageId(request(`/place/${ID}`, "HEAD")), ID);
  assert.equal(placePageId(request(`/place/${ID}`, "POST")), null);
  assert.equal(placePageId(request(`/place/${ID}/check`)), null);
  assert.equal(placePageId(request(`/api/places/${ID}`)), null);
  assert.equal(placePageId(request("/place/not-a-uuid")), null);
  assert.equal(placePageId(request("/place/%E0%A4%A")), null);
  assert.equal(placePageId(request("/city/london")), null);
});

test("an unverified place page gets X-Robots-Tag: noindex and keeps its other headers", async () => {
  const seen: string[] = [];
  const response = await withPlaceRobotsHeader(request(`/place/${ID}`), async () => html(), async (id) => (seen.push(id), true));
  assert.deepEqual(seen, [ID]);
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "<html></html>");
});

test("verified places, failed lookups, other paths and non-HTML responses are left alone", async () => {
  const verified = await withPlaceRobotsHeader(request(`/place/${ID}`), async () => html(), async () => false);
  assert.equal(verified.headers.get("x-robots-tag"), null);
  const failed = await withPlaceRobotsHeader(request(`/place/${ID}`), async () => html(), async () => {
    throw new Error("D1 down");
  });
  assert.equal(failed.headers.get("x-robots-tag"), null);
  let asked = false;
  const other = await withPlaceRobotsHeader(request("/city/london"), async () => html(), async () => (asked = true));
  assert.equal(asked, false);
  assert.equal(other.headers.get("x-robots-tag"), null);
  const flight = await withPlaceRobotsHeader(request(`/place/${ID}`), async () => new Response("0:{}", { headers: { "content-type": "text/x-component" } }), async () => true);
  assert.equal(flight.headers.get("x-robots-tag"), null);
});
