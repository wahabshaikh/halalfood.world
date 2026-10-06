import { test } from "node:test";
import assert from "node:assert/strict";
import { addPlaceFromGoogle, cityFromFormattedAddress } from "@/lib/google-place-submission";
import type { GooglePlaceDetailsResult } from "@/lib/google-places";
import { addPlace, addProfile, addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";

function details(id = "ChIJnew"): GooglePlaceDetailsResult {
  return {
    ok: true,
    place: {
      id,
      displayName: { text: "Zaitoon Kitchen" },
      formattedAddress: "Hill Rd, Bandra West, Mumbai 400050, India",
      addressComponents: [{ longText: "Mumbai", shortText: "Mumbai", types: ["locality"] }],
    },
    coordinates: { lat: 19.05, lng: 72.83 },
  } as unknown as GooglePlaceDetailsResult;
}

function world() {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "adder");
  addProfile(sqlite, "adder");
  return { sqlite, db };
}

const base = { name: "Zaitoon Kitchen", address: "Hill Rd, Mumbai, India", city: null };

test("a formatted address still yields a city without Place Details", () => {
  assert.equal(cityFromFormattedAddress("1 Example Street, London, England, United Kingdom"), "London");
  assert.equal(cityFromFormattedAddress("London, United Kingdom"), "London");
});

test("a new place goes live at once, and answers count as check 1", async () => {
  const { sqlite, db } = world();
  const result = await addPlaceFromGoogle(
    "adder",
    { googlePlaceId: "ChIJnew", ...base, answers: { owned: "yes", certified: null, pork: "no", alcohol: "no" } },
    "addkey-000001",
    { client: db, reserve: async () => true, hasApiKey: () => true, fetchDetails: async () => details() },
  );
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.status, "checking");
  const place = sqlite.prepare(`SELECT name, city_slug, listing_status, lat FROM places WHERE id = ?`).get(result.id) as Record<string, unknown>;
  assert.equal(place.name, "Zaitoon Kitchen");
  assert.equal(place.city_slug, "mumbai");
  assert.equal(place.listing_status, "listed");
  assert.equal(place.lat, 19.05);
  const points = sqlite.prepare(`SELECT kind FROM points WHERE user_id = 'adder' ORDER BY kind`).all() as { kind: string }[];
  assert.deepEqual(points.map((row) => row.kind), ["check", "place-added"]);
});

test("without answers the place starts unchecked", async () => {
  const { db } = world();
  const result = await addPlaceFromGoogle("adder", { googlePlaceId: "ChIJnew", ...base, answers: null }, "addkey-000002", {
    client: db,
    reserve: async () => true,
    hasApiKey: () => true,
    fetchDetails: async () => details(),
  });
  assert.ok(result.ok && result.status === "unchecked");
});

test("an already listed Google place is refused before calling Google", async () => {
  const { sqlite, db } = world();
  const existing = addPlace(sqlite, { googlePlaceId: "ChIJold" });
  let calls = 0;
  const result = await addPlaceFromGoogle("adder", { googlePlaceId: "ChIJold", ...base, answers: null }, "addkey-000003", {
    client: db,
    reserve: async () => {
      calls += 1;
      return true;
    },
  });
  assert.deepEqual(result, { ok: false, status: 409, error: "That place is already listed.", existingId: existing });
  assert.equal(calls, 0);
});

test("a spent Place Details budget lists the picked result without a pin", async () => {
  const { sqlite, db } = world();
  const result = await addPlaceFromGoogle("adder", { googlePlaceId: "ChIJcapped", ...base, answers: null }, "addkey-000004", {
    client: db,
    reserve: async () => false,
    fetchDetails: async () => {
      throw new Error("Google must not be called");
    },
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  const place = sqlite.prepare(`SELECT city_slug, lat FROM places WHERE id = ?`).get(result.id) as Record<string, unknown>;
  assert.equal(place.city_slug, "mumbai");
  assert.equal(place.lat, null);
});
