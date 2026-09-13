import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
async function get(path, status = 200) {
  const response = await fetch(base + path);
  assert.equal(response.status, status, path);
  return response.json();
}
const all = await get("/api/places?bbox=-180,-90,180,90&limit=99999");
assert.ok(all.total > 0);
assert.ok(all.places.length <= 600);
assert.equal(all.limit, 600);
const local = await get("/api/places?bbox=72.8,19,73,19.2&limit=3");
assert.ok(local.places.length <= 3);
for (const place of local.places) {
  assert.ok(place.lat >= 19 && place.lat <= 19.2);
  assert.ok(place.lng >= 72.8 && place.lng <= 73);
}
const search = await get("/api/places/search?q=mumbai&limit=99999");
assert.ok(search.places.length > 0 && search.places.length <= 40);
assert.equal(search.limit, 40);
const crossing = await get("/api/places?bbox=170,-10,-170,10&limit=5");
for (const place of crossing.places)
  assert.ok(place.lng >= 170 || place.lng <= -170);
await get("/api/places?bbox=bad", 400);
await get("/api/places", 400);
await get("/api/places/search?q=a", 400);
await get("/api/places/search?q=mumbai&limit=-1", 400);
const wildcard = await get("/api/places/search?q=%25%25&limit=1");
assert.equal(wildcard.total, 0, "SQL wildcards must be treated literally");
console.log(
  "Live API checks passed: viewport coordinates, counts, caps, antimeridian, validation, wildcard escaping.",
);
