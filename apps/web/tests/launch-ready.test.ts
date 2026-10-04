import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validatePlaceSubmission } from "@halalfood/core/place-submission";
import { splitSqlStatements } from "../scripts/apply-d1-migrations";
import { findPlacesByCity, getCity, getPlaceById, loadCityRecord } from "../src/lib/places";
import { submitPlaceLink } from "../src/lib/place-link-submissions";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const SLAM = "081ea610-a74f-4990-b8ca-3216aac6dfc8";
const TAVERN = "be63903f-1a4e-4460-8dc4-e2a5aa13b509";
const TAVERNA = "3d7f99f4-d769-4ffc-b19a-de72ca507868";
const SHIVAS = "65992004-f61e-42b3-b4ea-2b7f9e8908ef";

function insertPlace(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
  id: string,
  name: string,
  city: string,
  extras: { lat?: number | null; lng?: number | null; address?: string; cuisine?: string } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO places (
        id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
        scraped_at, created_at, halal_confirmed, lat, lng
      ) VALUES (?, ?, ?, 'u', ?, ?, 'user-submitted', 'u', 1, 1, 1, ?, ?)`,
    )
    .run(
      id,
      name,
      city,
      extras.address ?? "1 Street",
      extras.cuisine ?? "[]",
      extras.lat === undefined ? 1 : extras.lat,
      extras.lng === undefined ? 1 : extras.lng,
    );
}

test("migration comments are not statement boundaries or wrangler flags", () => {
  const feed = splitSqlStatements(
    readFileSync(join(import.meta.dirname, "../migrations/0015_social_feed.sql"), "utf8"),
  );
  assert.ok(feed.length >= 2);
  assert.ok(feed.every((statement) => !statement.startsWith("--")));
  assert.ok(feed.every((statement) => !statement.startsWith("this column")));
  assert.ok(
    feed.some(
      (statement) =>
        statement.startsWith("ALTER TABLE") && statement.includes('"verdict"'),
    ),
  );

  const indexes = splitSqlStatements(
    readFileSync(
      join(import.meta.dirname, "../migrations/0013_read_budget_indexes.sql"),
      "utf8",
    ),
  );
  assert.deepEqual(
    indexes.map((statement) => statement.startsWith("CREATE INDEX")),
    [true, true],
  );

  const listed = splitSqlStatements(
    readFileSync(
      join(import.meta.dirname, "../migrations/0021_public_listing_indexes.sql"),
      "utf8",
    ),
  );
  assert.equal(listed.length, 3);
  assert.ok(listed.every((statement) => statement.startsWith("CREATE INDEX IF NOT EXISTS")));
});

test("the visibility migration hides non-halal names, pins Slam Burger, and clears the Halal cuisine label", async () => {
  const { sqlite, db } = createTestDatabase();
  insertPlace(sqlite, TAVERN, "Valais-style Tavern", "geneva");
  insertPlace(sqlite, TAVERNA, "Lebanese Taverna", "baltimore");
  insertPlace(sqlite, SHIVAS, "Shivas Bar and Grill", "dallas");
  insertPlace(sqlite, "estabulo", "Estabulo Rodizio Bar & Grill - Leeds", "leeds");
  insertPlace(sqlite, SLAM, "Slam Burger Luton", "luton", {
    lat: null,
    lng: null,
    address: "180 Dunstable Rd",
    cuisine: '["Halal"]',
  });
  const file = readFileSync(
    join(import.meta.dirname, "../migrations/0020_listing_visibility.sql"),
    "utf8",
  );
  for (const statement of splitSqlStatements(file)) {
    if (/^\s*UPDATE/i.test(statement)) sqlite.exec(statement);
  }
  const status = (id: string) =>
    (sqlite.prepare(`SELECT listing_status AS status FROM places WHERE id = ?`).get(id) as { status: string })
      .status;
  assert.equal(status(TAVERN), "hidden");
  assert.equal(status(SHIVAS), "hidden");
  assert.equal(status(TAVERNA), "listed");
  assert.equal(status("estabulo"), "listed");
  const slam = sqlite
    .prepare(`SELECT lat, lng, serves_cuisine, listing_status FROM places WHERE id = ?`)
    .get(SLAM) as { lat: number; lng: number; serves_cuisine: string; listing_status: string };
  assert.equal(slam.listing_status, "listed");
  assert.ok(Math.abs(slam.lat - 51.8868333) < 0.0001);
  assert.ok(Math.abs(slam.lng - -0.4312885) < 0.0001);
  assert.equal(slam.serves_cuisine, "[]");

  // The place existed before 0020; the pin update is what makes Luton a real city page.
  // A slug with no listed place is missing (the page turns that into HTTP 404).
  const luton = await loadCityRecord("luton", db);
  assert.equal(luton.status, "ok");
  if (luton.status !== "ok") return;
  assert.equal(luton.data.city_slug, "luton");
  assert.equal(luton.data.place_count, 1);
  assert.ok(luton.data.center_lat !== null && Math.abs(luton.data.center_lat - 51.8868333) < 0.0001);
  const listing = await findPlacesByCity("luton", { limit: 10 }, db);
  assert.equal(listing.places[0]?.name, "Slam Burger Luton");
  assert.equal(listing.places[0]?.street_address, "180 Dunstable Rd");

  assert.equal((await loadCityRecord("zzzz-nowhere", db)).status, "missing");
  assert.equal((await findPlacesByCity("zzzz-nowhere", { limit: 10 }, db)).places.length, 0);
  assert.equal((await loadCityRecord("Not A City!!!", db)).status, "missing");
});

test("a city whose only place has no pin still resolves, and a hidden place does not", async () => {
  const { sqlite, db } = createTestDatabase();
  insertPlace(sqlite, SLAM, "Slam Burger Luton", "luton", { lat: null, lng: null });
  insertPlace(sqlite, TAVERN, "Valais-style Tavern", "geneva");
  sqlite.prepare(`UPDATE places SET listing_status = 'hidden' WHERE id = ?`).run(TAVERN);

  const city = await getCity("luton", db);
  assert.ok(city);
  assert.equal(city?.place_count, 1);
  const listing = await findPlacesByCity("luton", { limit: 10 }, db);
  assert.equal(listing.places.length, 1);
  assert.equal(listing.places[0]?.name, "Slam Burger Luton");
  assert.equal(listing.places[0]?.lat, null);

  assert.equal(await getPlaceById(TAVERN, db), null);
  assert.equal(await getCity("geneva", db), null);
});

test("a Google add is filed pending and does not publish a place", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "diner");
  const filed = await submitPlaceLink(
    "diner",
    {
      mode: "link",
      name: "New Kitchen",
      city: "Luton",
      citySlug: "luton",
      address: "180 Dunstable Rd",
      sourceUrl: "https://www.google.com/maps/search/?api=1&query_place_id=ChIJexample",
      googlePlaceId: "ChIJexample",
      halalConfirmed: true,
    },
    db,
    "google",
  );
  assert.equal(filed.ok, true);
  if (!filed.ok) return;
  assert.equal(filed.status, "pending");
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM places`).get() as { n: number }).n,
    0,
  );
  const reason = sqlite
    .prepare(`SELECT status_reason FROM place_link_submissions WHERE id = ?`)
    .get(filed.id) as { status_reason: string };
  assert.match(reason.status_reason, /Google place/);
  assert.match(reason.status_reason, /not a halal certification/i);
  const validation = validatePlaceSubmission({
    mode: "google",
    googlePlaceId: "ChIJexample",
    halalConfirmed: true,
  });
  assert.equal(validation.ok, true);
});
