import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverPlaces } from "../src/lib/discovery";
import { onboardingPickQueries } from "../src/lib/onboarding-picks";
import { createTestDatabase } from "./support/sqlite-d1";

const LISTED = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("no chosen standard asks for listed places, then drops an empty city", () => {
  const queries = onboardingPickQueries(new URLSearchParams("city=mumbai"));
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].filters.statuses, []);
  assert.deepEqual(queries[0].filters.facts, []);
  assert.equal(queries[0].citySlug, "mumbai");
  assert.equal(queries[1].citySlug, undefined);
  assert.deepEqual(queries[1].filters.statuses, []);
});

test("a chosen community standard excludes unchecked places, then falls back", () => {
  const queries = onboardingPickQueries(
    new URLSearchParams("standard=1&preset=community&city=mumbai"),
  );
  assert.equal(queries[0].filters.statuses.includes("community-verified"), true);
  assert.equal(queries[0].filters.statuses.includes("verified"), true);
  assert.equal(queries[0].filters.statuses.includes("unverified"), false);
  assert.deepEqual(queries[1].filters.statuses, []);
  assert.equal(queries[1].citySlug, "mumbai");
  assert.equal(queries[2].citySlug, undefined);
});

test("a listed place with no halal check is offered when no standard is picked", async () => {
  const { sqlite, db } = createTestDatabase();
  sqlite
    .prepare(
      `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed, lat, lng)
       VALUES (?, 'Imported Grill', 'mumbai', 'u', 'a', '[]', 's', 'u', 1, 1, 1, 19.07, 72.87)`,
    )
    .run(LISTED);

  const open = onboardingPickQueries(new URLSearchParams("city=mumbai"))[0];
  const openResult = await discoverPlaces(
    { filters: open.filters, citySlug: open.citySlug, limit: 8 },
    db,
  );
  assert.deepEqual(
    openResult.places.map((place) => place.id),
    [LISTED],
  );
  assert.equal(openResult.places[0].halal_status, "unverified");

  const strict = onboardingPickQueries(
    new URLSearchParams("standard=1&preset=community&city=mumbai"),
  )[0];
  const strictResult = await discoverPlaces(
    { filters: strict.filters, citySlug: strict.citySlug, limit: 8 },
    db,
  );
  assert.deepEqual(strictResult.places, []);

  const fallback = onboardingPickQueries(
    new URLSearchParams("standard=1&preset=community&city=mumbai"),
  )[1];
  const fallbackResult = await discoverPlaces(
    { filters: fallback.filters, citySlug: fallback.citySlug, limit: 8 },
    db,
  );
  assert.deepEqual(
    fallbackResult.places.map((place) => place.id),
    [LISTED],
  );
});
