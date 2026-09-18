import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CITY_SLUG,
  assertMumbaiCitySlug,
  assertMumbaiScopedSql,
  buildLegacyPlaceDetailsUrl,
  buildPlaceDetailsUpdateSql,
  compactSnapshotFromLegacyResult,
  formatBackfillLogLine,
  mapLegacyPlaceDetails,
  shouldSkipPayload,
  LIST_MUMBAI_PLACES_SQL,
  UPDATE_MUMBAI_PLACE_DETAILS_SQL,
} from "../scripts/backfill-mumbai-place-details";
import { planStatements } from "../scripts/apply-d1-migrations";

test("the backfill is Mumbai-only", () => {
  assert.equal(CITY_SLUG, "mumbai");
  assert.doesNotThrow(() => assertMumbaiCitySlug("mumbai"));
  for (const value of ["Mumbai", "mumbai ", "dubai"]) {
    assert.throws(() => assertMumbaiCitySlug(value));
  }
});

test("payload presence controls whether a row is skipped", () => {
  assert.match(LIST_MUMBAI_PLACES_SQL, /city_slug = 'mumbai'/);
  assert.match(
    LIST_MUMBAI_PLACES_SQL,
    /google_place_payload IS NULL OR trim\(google_place_payload\) = ''/,
  );
  assert.equal(shouldSkipPayload(null), false);
  assert.equal(shouldSkipPayload(""), false);
  assert.equal(shouldSkipPayload("  "), false);
  assert.equal(shouldSkipPayload('{"name":"Already fetched"}'), true);
});

test("Mumbai SQL guard requires the exact city predicate", () => {
  assert.doesNotThrow(() =>
    assertMumbaiScopedSql("SELECT id FROM places WHERE city_slug = 'mumbai'"),
  );
  assert.doesNotThrow(() =>
    assertMumbaiScopedSql(
      "UPDATE places SET lat = ? WHERE city_slug = 'mumbai' AND id = ?",
    ),
  );
  assert.throws(() => assertMumbaiScopedSql("SELECT id FROM places"));
  assert.throws(() =>
    assertMumbaiScopedSql("UPDATE places SET lat = ? WHERE city_slug = ?"),
  );
});

test("legacy result rewrites the compact snapshot without a displayName object", () => {
  const fixture = {
    name: "Mumbai Halal Kitchen",
    formatted_address: "1 Example Road, Mumbai",
    geometry: { location: { lat: 19.076, lng: 72.8777 } },
    international_phone_number: "+91 22 1234 5678",
    website: "https://example.test",
    url: "https://maps.google.test/place/example",
    rating: 4.6,
    user_ratings_total: 321,
    address_components: [{ long_name: "Mumbai" }],
  };
  const snapshot = compactSnapshotFromLegacyResult(fixture);
  assert.deepEqual(snapshot, {
    displayName: "Mumbai Halal Kitchen",
    formattedAddress: "1 Example Road, Mumbai",
    coordinates: { lat: 19.076, lng: 72.8777 },
  });

  const update = mapLegacyPlaceDetails(fixture, "ChIJmumbai", 1770000000000);
  assert.ok(update);
  assert.deepEqual(JSON.parse(update.googleDetailsSnapshot), snapshot);
  assert.equal(update.googlePlacePayload, JSON.stringify(fixture));
  assert.equal(update.telephone, "+91 22 1234 5678");
  assert.equal(update.ratingValue, "4.6");
  assert.equal(update.reviewCount, 321);
  assert.equal(update.googlePlaceFetchedAt, update.googleDetailsCachedAt);
});

test("the details update never changes listing name or street address", () => {
  const sql = buildPlaceDetailsUpdateSql();
  assert.equal(sql, UPDATE_MUMBAI_PLACE_DETAILS_SQL);
  assert.doesNotMatch(sql, /\bname\s*=/i);
  assert.doesNotMatch(sql, /\bstreet_address\s*=/i);
  assert.match(sql, /city_slug = 'mumbai'/);
});

test("legacy URL includes place_id and key but no fields parameter", () => {
  const url = buildLegacyPlaceDetailsUrl("ChIJ/example", "fixture-key");
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("place_id"), "ChIJ/example");
  assert.equal(parsed.searchParams.get("key"), "fixture-key");
  assert.equal(parsed.searchParams.get("fields"), null);
  assert.doesNotMatch(url, /[?&]fields=/);
});

test("backfill log lines contain no API key or URL", () => {
  const key = "fixture-secret-key";
  const line = formatBackfillLogLine("ChIJmumbai", "REQUEST_DENIED");
  assert.equal(line.includes(key), false);
  const unsafe = formatBackfillLogLine(
    "ChIJmumbai",
    `https://maps.googleapis.com/?key=${key}`,
  );
  assert.equal(unsafe.includes(key), false);
  assert.match(line, /place_id=ChIJmumbai status=REQUEST_DENIED/);
});

test("migration planner keeps missing ADD COLUMN statements", () => {
  const sql = `
    ALTER TABLE "places" ADD COLUMN "google_place_payload" TEXT;
    ALTER TABLE places ADD COLUMN google_place_fetched_at INTEGER;
  `;
  assert.equal(planStatements(sql, []).length, 2);
});

test("migration planner drops an ADD COLUMN already present", () => {
  const sql = `ALTER TABLE "places" ADD COLUMN "google_place_payload" TEXT;`;
  assert.deepEqual(planStatements(sql, ["google_place_payload"]), []);
});

test("migration planner handles the two payload columns independently", () => {
  const sql = `
    ALTER TABLE "places" ADD COLUMN "google_place_payload" TEXT;
    ALTER TABLE "places" ADD COLUMN "google_place_fetched_at" INTEGER;
  `;
  const planned = planStatements(sql, ["google_place_payload"]);
  assert.equal(planned.length, 1);
  assert.match(planned[0], /google_place_fetched_at/);
  assert.doesNotMatch(planned.join("\n"), /google_place_payload/);
});

test("migration planner keeps other statements and never drops payload data", () => {
  const sql = `
    CREATE INDEX place_city_idx ON places(city_slug);
    ALTER TABLE other_table ADD COLUMN note TEXT;
  `;
  const planned = planStatements(sql, ["google_place_payload"]);
  assert.equal(planned.length, 2);
  assert.doesNotMatch(planned.join("\n"), /DROP/i);
  assert.throws(() => planStatements("DROP TABLE places;", []));
});
