import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonical,
  cityDescription,
  cityName,
  cityTitle,
  formatAddress,
  jsonLdScript,
  placeDescription,
  placeJsonLd,
  placeShareText,
  placeTitle,
  plural,
  truncate,
} from "../src/lib/seo";
import {
  PLACE_CHUNK,
  placeChunkIds,
  sitemapIndexXml,
  toLastModified,
} from "../src/lib/sitemap";

const verified = { kind: "verified" } as const;
const facts = { owned: "yes", certified: "yes", pork: "no", alcohol: null } as const;

const place = {
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  name: "Bademiya",
  city_slug: "mumbai",
  street_address: "Tulloch Road",
  address_locality: "Mumbai",
  address_region: "Maharashtra",
  postal_code: "400001",
  address_country: "India",
  telephone: "+91 22 1234 5678",
  website: "https://example.com",
  serves_cuisine: ["Indian", "Kebab"],
  lat: 18.9219,
  lng: 72.8323,
};

test("city slugs become readable names", () => {
  assert.equal(cityName("mumbai"), "Mumbai");
  assert.equal(cityName("new-york-city"), "New York City");
  assert.equal(cityName("stoke-on-trent"), "Stoke on Trent");
  assert.equal(cityName("rio-de-janeiro"), "Rio de Janeiro");
  assert.equal(cityName(""), "");
});

test("canonical URLs resolve against the production origin", () => {
  assert.equal(canonical("/"), "https://halalfood.world/");
  assert.equal(canonical("/city/mumbai"), "https://halalfood.world/city/mumbai");
  assert.equal(
    canonical("/place/" + place.id),
    "https://halalfood.world/place/" + place.id,
  );
});

test("descriptions stay within the meta description budget", () => {
  assert.ok(placeDescription(place, verified, facts).length <= 160);
  assert.ok(cityDescription("mumbai", 2431).length <= 160);
  const long = truncate("a b ".repeat(200));
  assert.ok(long.length <= 160);
  assert.ok(long.endsWith("…"));
  assert.equal(truncate("short enough"), "short enough");
});

test("titles, share text and descriptions state the community status", () => {
  assert.equal(cityTitle("mumbai", 2431), "2,431 places listed in Mumbai");
  assert.equal(cityTitle("mumbai", 1), "1 place listed in Mumbai");
  assert.equal(cityTitle("mumbai", 0), "Places listed in Mumbai");
  assert.equal(plural(1, "place"), "place");
  assert.equal(plural(2, "city", "cities"), "cities");
  assert.equal(placeTitle(place), "Bademiya in Mumbai");
  assert.equal(placeShareText("Bademiya", "Mumbai", { kind: "unchecked" }), "Bademiya in Mumbai. Not checked yet.");
  assert.equal(
    placeShareText("Bademiya", "Mumbai", { kind: "checking", progress: 2 }),
    "Bademiya in Mumbai. 2 of 3 community checks so far.",
  );
  const description = placeDescription(place, verified, facts);
  assert.match(description, /Verified/);
  assert.match(description, /Muslim-owned: Yes/);
  assert.equal(placeDescription({ ...place, serves_cuisine: ["Halal"] }, verified, facts).includes("Halal,"), false);
});

test("addresses skip missing parts without leaving stray separators", () => {
  assert.equal(
    formatAddress(place),
    "Tulloch Road, Mumbai, Maharashtra, India",
  );
  assert.equal(
    formatAddress({ street_address: "Main St", address_country: null }),
    "Main St",
  );
  assert.equal(formatAddress({}), "");
});

test("JSON-LD carries the community status as properties, never as a rating", () => {
  const data = placeJsonLd(place, { status: verified, facts }) as Record<string, any>;
  assert.equal(data["@type"], "Restaurant");
  assert.equal(data.url, "https://halalfood.world/place/" + place.id);
  assert.equal(data.geo.latitude, place.lat);
  assert.equal(data.aggregateRating, undefined);
  assert.deepEqual(data.servesCuisine, ["Indian", "Kebab"]);
  const names = data.additionalProperty.map((property: { name: string }) => property.name);
  assert.deepEqual(names, ["communityStatus", "Muslim-owned", "Halal certified", "Pork"]);
  const halalLabel = placeJsonLd({ ...place, serves_cuisine: ["Halal"] }, { status: verified, facts }) as Record<string, unknown>;
  assert.equal(halalLabel.servesCuisine, undefined);
  const noGeo = placeJsonLd({ ...place, lat: null, lng: null }, { status: verified, facts }) as Record<string, unknown>;
  assert.equal(noGeo.geo, undefined);
});

test("JSON-LD payloads cannot break out of a script tag", () => {
  const script = jsonLdScript({ name: "</script><img onerror=x>" });
  assert.ok(!script.includes("</script>"));
  assert.equal(JSON.parse(script).name, "</script><img onerror=x>");
});

test("place sitemaps are chunked and capped", () => {
  assert.deepEqual(placeChunkIds(0), []);
  assert.deepEqual(placeChunkIds(1), [0]);
  assert.deepEqual(placeChunkIds(PLACE_CHUNK), [0]);
  assert.deepEqual(placeChunkIds(PLACE_CHUNK + 1), [0, 1]);
  assert.deepEqual(placeChunkIds(11957), [0, 1, 2]);
  assert.equal(placeChunkIds(100_000_000).length, 50);
});

test("the sitemap index lists absolute child URLs", () => {
  const xml = sitemapIndexXml([
    { path: "/sitemaps/cities/sitemap.xml" },
    { path: "/sitemaps/places/sitemap/0.xml", lastModified: new Date(0) },
  ]);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes("<sitemapindex"));
  assert.ok(
    xml.includes(
      "<loc>https://halalfood.world/sitemaps/cities/sitemap.xml</loc>",
    ),
  );
  assert.ok(xml.includes("<lastmod>1970-01-01T00:00:00.000Z</lastmod>"));
  assert.equal(xml.match(/<sitemap>/g)?.length, 2);
});

test("unparseable timestamps drop out of lastmod", () => {
  assert.equal(toLastModified(null), undefined);
  assert.equal(toLastModified("not a date"), undefined);
  assert.equal(
    toLastModified("2026-01-02T03:04:05.000Z")?.toISOString(),
    "2026-01-02T03:04:05.000Z",
  );
});
