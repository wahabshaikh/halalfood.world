import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPROXIMATE_NOTE,
  canonical,
  cityDescription,
  cityName,
  cityTitle,
  formatAddress,
  jsonLdScript,
  placeDescription,
  placeJsonLd,
  cityEvidencePhrase,
  evidenceSharePhrase,
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
  rating_value: "4.30",
  review_count: 1240,
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

test("city share text states the evidence mix and keeps the certification line", () => {
  const unchecked = cityDescription("mumbai", 7700, {
    indexed: 7700,
    enriched: 0,
    intelligent: 0,
    trusted: 0,
  });
  assert.equal(unchecked.includes("Unverified, not yet checked by the community"), true);
  assert.equal(unchecked.includes("not a halal certification"), true);
  assert.ok(unchecked.length <= 160);

  const mixed = cityDescription("mumbai", 7700, {
    indexed: 5000,
    enriched: 2000,
    intelligent: 400,
    trusted: 300,
  });
  assert.equal(mixed.includes(cityEvidencePhrase({
    indexed: 5000,
    enriched: 2000,
    intelligent: 400,
    trusted: 300,
  })), true);
  assert.equal(mixed.includes("not a halal certification"), true);
  assert.ok(mixed.length <= 160);

  const checked = cityDescription("mumbai", 12, {
    indexed: 0,
    enriched: 4,
    intelligent: 5,
    trusted: 3,
  });
  assert.equal(checked.includes("Checked by the community"), true);
  assert.equal(checked.includes("not a halal certification"), true);
  assert.equal(cityDescription("mumbai", 12, null).includes("could not be loaded"), true);
  assert.equal(evidenceSharePhrase("not-halal"), "Not halal, checked by the community");
});

test("descriptions stay within the meta description budget", () => {
  assert.ok(placeDescription(place).length <= 160);
  assert.ok(cityDescription("mumbai", 2431).length <= 160);
  const long = truncate("a b ".repeat(200));
  assert.ok(long.length <= 160);
  assert.ok(long.endsWith("…"));
  assert.equal(truncate("short enough"), "short enough");
});

test("titles and counts read naturally in both numbers", () => {
  assert.equal(cityTitle("mumbai", 2431), "2,431 places listed in Mumbai");
  assert.equal(cityTitle("mumbai", 1), "1 place listed in Mumbai");
  assert.equal(cityTitle("mumbai", 0), "Places listed in Mumbai");
  assert.equal(cityTitle("mumbai", 2431).toLowerCase().includes("halal"), false);
  assert.equal(plural(1, "place"), "place");
  assert.equal(plural(2, "city", "cities"), "cities");
  assert.equal(placeTitle(place), "Bademiya in Mumbai");
  assert.equal(
    placeShareText("Bademiya", "Mumbai", "unverified"),
    "Bademiya in Mumbai. Unverified, not yet checked by the community. A listing is not a halal certification.",
  );
  assert.equal(
    placeShareText("Bademiya", "Mumbai", "verified"),
    "Bademiya in Mumbai. Verified halal, checked by the community. A listing is not a halal certification.",
  );
  assert.equal(
    placeShareText("Bademiya", "Mumbai", "community-verified"),
    "Bademiya in Mumbai. Community verified, checked by the community. A listing is not a halal certification.",
  );
  assert.equal(placeShareText("Bademiya", "Mumbai", null).includes("could not be loaded"), true);
  assert.equal(placeDescription(place).includes("not a halal certification"), true);
  const withStatus = placeDescription(place, { evidenceStatus: "unverified" });
  assert.equal(withStatus.includes("Unverified, not yet checked by the community"), true);
  assert.equal(withStatus.includes("not a halal certification"), true);
  assert.ok(withStatus.length <= 160);
  const verified = placeDescription(place, {
    includeCommunity: true,
    evidenceStatus: "verified",
  });
  assert.equal(verified.includes("Verified halal, checked by the community"), true);
  assert.equal(verified.includes("not a halal certification"), true);
  assert.ok(verified.length <= 160);
  assert.equal(placeDescription(place).includes("Google rating"), true);
  assert.equal(placeDescription(place).includes("Map location is approximate."), true);
  assert.equal(placeDescription(place).includes("a halal Halal"), false);
  const longName = placeDescription(
    {
      ...place,
      name: "Kirin Beer Garden in Urban Sapporo Building",
      address_locality: "Sapporo",
      serves_cuisine: ["Halal"],
    },
    { includeCommunity: true },
  );
  assert.equal(longName.includes("Map location is approximate."), true);
  assert.equal(longName.includes("Map location is…"), false);
  assert.equal(longName.includes("a halal Halal"), false);
  assert.ok(longName.length <= 160);
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

test("JSON-LD marks the coordinates as approximate", () => {
  const data = placeJsonLd(place) as Record<string, any>;
  assert.equal(data["@type"], "Restaurant");
  assert.equal(data.url, "https://halalfood.world/place/" + place.id);
  assert.equal(data.geo.latitude, place.lat);
  assert.equal(data.geo.additionalProperty.value, "approximate");
  assert.equal(data.disambiguatingDescription, APPROXIMATE_NOTE);
  assert.equal(data.aggregateRating.ratingValue, 4.3);
  assert.equal(data.aggregateRating.reviewCount, 1240);
  assert.deepEqual(data.servesCuisine, ["Indian", "Kebab"]);
  const halalLabel = placeJsonLd({ ...place, serves_cuisine: ["Halal"] }) as Record<string, unknown>;
  assert.equal(halalLabel.servesCuisine, undefined);
});

test("JSON-LD omits geo when the row has no coordinates", () => {
  const data = placeJsonLd({ ...place, lat: null, lng: null }) as Record<
    string,
    any
  >;
  assert.equal(data.geo, undefined);
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
