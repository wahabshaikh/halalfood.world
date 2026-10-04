import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ValidatedGoogleSubmission } from "@halalfood/core/place-submission";
import { GOOGLE_PLACES_ADD_FIELD_MASK } from "../src/lib/google-places";
import {
  cityFromFormattedAddress,
  linkFromSelectedGooglePlace,
  respondToGooglePlaceSubmission,
} from "../src/lib/google-place-submission";
import type { LinkSubmissionResult } from "../src/lib/place-link-submissions";

const GOOGLE_ID = "ChIJexample";

function submission(overrides: Partial<ValidatedGoogleSubmission> = {}): ValidatedGoogleSubmission {
  return {
    mode: "google",
    googlePlaceId: GOOGLE_ID,
    halalConfirmed: true,
    name: "Saved Halal Kitchen",
    address: "1 Example Street, London, United Kingdom",
    city: null,
    ...overrides,
  };
}

test("a formatted address still yields a city without Place Details", () => {
  assert.equal(cityFromFormattedAddress("1 Example Street, London, England, United Kingdom"), "London");
  assert.equal(cityFromFormattedAddress("7 Boundary St, London E2 7JE, UK"), "London");
  assert.equal(cityFromFormattedAddress("London, United Kingdom"), "London");
  assert.equal(cityFromFormattedAddress("221B Baker Street, London"), "London");
});

test("a full Place Details cap files the picked place and does not call Google", async () => {
  let fetches = 0;
  let filed: { name: string; address: string; city: string; sourceUrl: string; googlePlaceId: string | null; reason?: string } | null =
    null;
  const response = await respondToGooglePlaceSubmission("user-1", submission(), {
    now: () => new Date("2026-10-04T12:00:00.000Z"),
    reserve: async () => false,
    fetchDetails: async () => {
      fetches += 1;
      throw new Error("Google must not be called");
    },
    submit: async (_userId, input, _client, source, reason) => {
      filed = {
        name: input.name,
        address: input.address,
        city: input.city,
        sourceUrl: input.sourceUrl,
        googlePlaceId: input.googlePlaceId,
        reason,
      };
      assert.equal(source, "google");
      const result: LinkSubmissionResult = { ok: true, id: "sub-1", status: "pending", deduped: false };
      return result;
    },
  });

  assert.equal(fetches, 0);
  assert.equal(response.status, 201);
  const body = (await response.json()) as { id: string; listed: boolean };
  assert.equal(body.id, "sub-1");
  assert.equal(body.listed, false);
  assert.deepEqual(filed, {
    name: "Saved Halal Kitchen",
    address: "1 Example Street, London, United Kingdom",
    city: "London",
    sourceUrl: "https://www.google.com/maps/search/?api=1&query=Google&query_place_id=ChIJexample",
    googlePlaceId: GOOGLE_ID,
    reason:
      "Filed from the selected Google result without a Place Details lookup. Not listed and not a halal certification.",
  });
});

test("a Place Details reservation still fetches Google and ignores the picked name", async () => {
  let mask = "";
  let filedName = "";
  const response = await respondToGooglePlaceSubmission("user-1", submission({ name: "Typed name" }), {
    reserve: async () => true,
    hasApiKey: () => true,
    fetchDetails: async (_placeId, options) => {
      mask = options?.fieldMask ?? "";
      return {
        ok: true,
        place: {
          id: GOOGLE_ID,
          displayName: { text: "Live Halal Kitchen" },
          formattedAddress: "Live Google address",
          location: { latitude: 51.5, longitude: -0.1 },
          addressComponents: [{ longText: "London", types: ["locality"] }],
        },
        coordinates: { lat: 51.5, lng: -0.1 },
      };
    },
    submit: async (_userId, input) => {
      filedName = input.name;
      return { ok: true, id: "sub-2", status: "pending", deduped: false };
    },
  });

  assert.equal(mask, GOOGLE_PLACES_ADD_FIELD_MASK);
  assert.equal(filedName, "Live Halal Kitchen");
  assert.equal(response.status, 201);
  assert.equal(linkFromSelectedGooglePlace(submission({ name: null })) , null);
});

test("the add form sends the picked name and address with the Google place", () => {
  const form = readFileSync(new URL("../app/add/add-place-form.tsx", import.meta.url), "utf8");
  assert.match(form, /googlePlaceId:\s*selected\.id/);
  assert.match(form, /name:\s*selected\.name/);
  assert.match(form, /address:\s*selected\.address/);
});
