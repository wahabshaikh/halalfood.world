import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bboxOf,
  geoapifyUrl,
  matchListings,
  mergeGeoapify,
  overpassQuery,
  parseGeoapify,
  parseOverpass,
} from "./listing-signals";

test("parseOverpass reads diet:halal from nodes and ways", () => {
  const listings = parseOverpass({
    elements: [
      { type: "node", id: 1, lat: 51.5, lon: -0.1, tags: { name: "Noor Grill", "diet:halal": "only" } },
      { type: "way", id: 2, center: { lat: 51.6, lon: -0.2 }, tags: { name: "Pizza Place", "diet:halal": "limited" } },
      { type: "node", id: 3, lat: 51.5, lon: -0.1, tags: { name: "Odd", "diet:halal": "sometimes" } },
      { type: "node", id: 4, lat: 51.5, lon: -0.1, tags: { "diet:halal": "yes" } },
    ],
  });
  assert.deepEqual(
    listings.map((listing) => [listing.externalId, listing.claim, listing.lat]),
    [
      ["node/1", "only", 51.5],
      ["way/2", "yes", 51.6],
    ],
  );
  assert.deepEqual(parseOverpass(null), []);
});

test("Geoapify listings keep the stronger claim", () => {
  const feature = (id: string) => ({ properties: { place_id: id, name: `Place ${id}`, lat: 1, lon: 2 } });
  const only = parseGeoapify({ features: [feature("a")] }, "only");
  const any = parseGeoapify({ features: [feature("a"), feature("b")] }, "yes");
  assert.deepEqual(
    mergeGeoapify(only, any).map((listing) => [listing.externalId, listing.claim]),
    [
      ["a", "only"],
      ["b", "yes"],
    ],
  );
});

test("matchListings pairs a place with a nearby listing of the same venue", () => {
  const places = [
    { id: "p1", name: "Noor Grill House", citySlug: "london", lat: 51.5, lng: -0.1 },
    { id: "p2", name: "Saffron Kitchen", citySlug: "london", lat: 51.5, lng: -0.1 },
  ];
  const listings = [
    { provider: "osm" as const, externalId: "node/1", name: "Noor Grill", lat: 51.5003, lng: -0.1, claim: "only" as const },
    { provider: "osm" as const, externalId: "node/2", name: "Noor Grill House", lat: 51.51, lng: -0.1, claim: "yes" as const },
    { provider: "osm" as const, externalId: "node/3", name: "Burger Barn", lat: 51.5, lng: -0.1, claim: "yes" as const },
  ];
  assert.deepEqual(
    matchListings(places, listings).map((match) => [match.placeId, match.listing.externalId]),
    [["p1", "node/1"]],
  );
});

test("queries cover the padded box around the places", () => {
  const box = bboxOf([
    { lat: 51.5, lng: -0.1 },
    { lat: 51.6, lng: -0.2 },
  ]);
  assert.ok(box && box.south < 51.5 && box.north > 51.6 && box.west < -0.2 && box.east > -0.1);
  assert.equal(bboxOf([]), null);
  assert.match(overpassQuery(box!), /nwr\["diet:halal"\]\["name"\]\(51\.4\d+,-0\.2\d+,51\.6\d+,-0\.0\d+\)/);
  const url = new URL(geoapifyUrl(box!, "halal.only", "key"));
  assert.equal(url.searchParams.get("conditions"), "halal.only");
  assert.match(url.searchParams.get("filter") ?? "", /^rect:/);
});
