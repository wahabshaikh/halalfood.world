import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePlaceSubmission } from "@halalfood/core/place-submission";
import { respondToGooglePlaceSubmission, linkFromSelectedGooglePlace } from "../src/lib/google-place-submission";
import { duplicateBody, findExistingPlace, findExistingPlaces } from "../src/lib/place-duplicates";
import { matchListedPlace, sameVenueName } from "../src/lib/place-match";
import { submitPlaceLink } from "../src/lib/place-link-submissions";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const SLAM = "081ea610-a74f-4990-b8ca-3216aac6dfc8";
const LISTED_WITH_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const HIDDEN = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

function seed() {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "diner");
  addUser(sqlite, "other");
  const insert = sqlite.prepare(
    `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url,
       scraped_at, created_at, halal_confirmed, google_place_id, listing_status)
     VALUES (?, ?, ?, 'u', ?, '[]', 's', 'u', 1, 1, 1, ?, ?)`,
  );
  // Like prod: a user-submitted listing with no Google id.
  insert.run(SLAM, "Slam Burger Luton", "luton", "180 Dunstable Rd", null, "listed");
  insert.run(LISTED_WITH_ID, "Dishoom Shoreditch", "london", "7 Boundary St", "ChIJlisted", "listed");
  insert.run(HIDDEN, "Hidden Bar", "london", "1 Hidden St", "ChIJhidden", "hidden");
  sqlite
    .prepare(
      `INSERT INTO place_link_submissions (id, submitted_by_user_id, name, city_slug, street_address, source_url,
         google_place_id, status, status_reason, created_at, updated_at)
       VALUES ('sub-pending', 'other', 'Pending Grill', 'london', '2 New St', 'https://maps/p', 'ChIJpending', 'pending', 'r', 1, 1)`,
    )
    .run();
  return { sqlite, db };
}

const SLAM_GOOGLE = {
  googlePlaceId: "ChIJA0KxSlam",
  name: "Slamburger Halal Food in Luton, Halal Food Restaurant",
  citySlug: "luton",
  address: "180 Dunstable Rd, Luton LU4 8JN, UK",
};

test("a Google result for a listed place is found by id, by name, or by venue at the same address", async () => {
  const { db } = seed();
  const matches = await findExistingPlaces(
    [
      SLAM_GOOGLE,
      { googlePlaceId: "ChIJlisted", name: "Dishoom", citySlug: "london", address: "7 Boundary St, London E2 7JE, UK" },
      { googlePlaceId: "ChIJhidden", name: "Hidden Bar", citySlug: "london", address: "1 Hidden St, London, UK" },
      { googlePlaceId: "ChIJpending", name: "Pending Grill", citySlug: "london", address: "2 New St, London, UK" },
      { googlePlaceId: "ChIJnew", name: "Brand New Cafe", citySlug: "luton", address: "180 Dunstable Rd, Luton LU4 8JN, UK" },
    ],
    db,
  );
  assert.deepEqual(matches[0], { kind: "listed", placeId: SLAM, name: "Slam Burger Luton" });
  assert.deepEqual(matches[1], { kind: "listed", placeId: LISTED_WITH_ID, name: "Dishoom Shoreditch" });
  assert.equal(matches[2]?.kind, "unlisted");
  assert.equal(matches[3]?.kind, "pending");
  // Same address, different venue: not a duplicate.
  assert.equal(matches[4], null);
});

test("the server refuses a duplicate Google pick with a 409 and the listed place id", async () => {
  const { sqlite, db } = seed();
  const before = (sqlite.prepare(`SELECT COUNT(*) AS n FROM place_link_submissions`).get() as { n: number }).n;
  let detailsCalls = 0;
  const response = await respondToGooglePlaceSubmission(
    "diner",
    {
      mode: "google",
      googlePlaceId: SLAM_GOOGLE.googlePlaceId,
      halalConfirmed: true,
      name: SLAM_GOOGLE.name,
      address: SLAM_GOOGLE.address,
      city: null,
    },
    {
      findExisting: (candidate) => findExistingPlace(candidate, db),
      reserve: async () => {
        detailsCalls += 1;
        return true;
      },
      fetchDetails: async () => {
        detailsCalls += 1;
        throw new Error("no Google call for a duplicate");
      },
      submit: (userId, input, _client, source, reason) => submitPlaceLink(userId, input, db, source, reason),
    },
  );
  assert.equal(response.status, 409);
  const body = (await response.json()) as { placeId: string; id: string; url: string; code: string };
  assert.equal(body.placeId, SLAM);
  assert.equal(body.id, SLAM);
  assert.equal(body.url, `/place/${SLAM}`);
  assert.equal(body.code, "already_listed");
  assert.equal(detailsCalls, 0);
  const after = (sqlite.prepare(`SELECT COUNT(*) AS n FROM place_link_submissions`).get() as { n: number }).n;
  assert.equal(after, before);
});

test("submitPlaceLink refuses a pending or hidden Google id, even after Place Details", async () => {
  const { db } = seed();
  const pending = linkFromSelectedGooglePlace({
    mode: "google",
    googlePlaceId: "ChIJpending",
    halalConfirmed: true,
    name: "Pending Grill (Google name)",
    address: "2 New St, London, UK",
    city: "London",
  });
  assert.ok(pending);
  const refused = await submitPlaceLink("diner", pending, db, "google");
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.match.kind, "pending");
  const pendingBody = duplicateBody(refused.match, "diner");
  assert.equal(pendingBody.code, "already_pending");
  assert.equal(pendingBody.submissionId, null, "another person's submission id is not shown");
  assert.equal(duplicateBody(refused.match, "other").submissionId, "sub-pending");

  const hidden = validatePlaceSubmission({
    mode: "link",
    name: "Some other name",
    city: "London",
    address: "9 Elsewhere",
    sourceUrl: "https://www.google.com/maps/place/?q=place_id:ChIJhidden",
    halalConfirmed: true,
  });
  if (!hidden.ok || hidden.data.mode !== "link") throw new Error("link");
  const withId = { ...hidden.data, googlePlaceId: "ChIJhidden" };
  const hiddenRefused = await submitPlaceLink("diner", withId, db);
  assert.equal(hiddenRefused.ok, false);
  if (hiddenRefused.ok) return;
  const hiddenBody = duplicateBody(hiddenRefused.match);
  assert.equal(hiddenBody.placeId, null, "a hidden place id is not given out");
  assert.equal(hiddenBody.url, null);
});

test("venue names match across spacing and extra Google words, not across venues", () => {
  assert.equal(sameVenueName("Slam Burger Luton", SLAM_GOOGLE.name, "luton"), true);
  assert.equal(sameVenueName("Dishoom", "Dishoom Shoreditch", "london"), true);
  assert.equal(sameVenueName("Halal Food Kitchen", "Halal Grill House", "london"), false);
  assert.equal(sameVenueName("Brand New Cafe", "Slam Burger Luton", "luton"), false);
  assert.deepEqual(
    matchListedPlace(SLAM_GOOGLE, [{ id: SLAM, name: "Slam Burger Luton", address: "180 Dunstable Rd" }]),
    { id: SLAM, name: "Slam Burger Luton", address: "180 Dunstable Rd" },
  );
});

test("/add turns Add off for a result we already have and wraps a long name", () => {
  const form = readFileSync(new URL("../app/add/add-place-form.tsx", import.meta.url), "utf8");
  assert.match(form, /disabled=\{submitBusy \|\| Boolean\(selectedExisting\)\}/);
  assert.match(form, /whitespace-normal/);
  assert.match(form, /if \(selectedExisting\) return;/);
  const route = readFileSync(new URL("../app/api/places/google-search/route.ts", import.meta.url), "utf8");
  assert.match(route, /findExistingPlaces/);
});
