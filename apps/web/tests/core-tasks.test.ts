import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlaceSubmission } from "@halalfood/core/place-submission";
import { isFocusedFlow } from "../src/lib/focused-flow";
import { listContributions } from "../src/lib/contributions-repository";
import { submitPlaceLink } from "../src/lib/place-link-submissions";
import { nextSaveState } from "../src/lib/save-toggle";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const PLACE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("support chat steps aside on the flows with a fixed Next or Send", () => {
  assert.equal(isFocusedFlow("/place/e2c29649-d8c2-41c3-8057-b4dd09bb3998/check"), true);
  assert.equal(isFocusedFlow("/onboarding"), true);
  assert.equal(isFocusedFlow("/add"), true);
  assert.equal(isFocusedFlow("/send"), true);
  assert.equal(isFocusedFlow("/place/e2c29649-d8c2-41c3-8057-b4dd09bb3998"), false);
  assert.equal(isFocusedFlow("/map"), false);
});

test("a failed removal puts the button back on Saved", () => {
  assert.deepEqual(nextSaveState(true, false, { ok: false }), {
    saved: true,
    error: "Could not update saved places. Please try again.",
  });
  assert.deepEqual(nextSaveState(true, false, { ok: true, saved: true }), {
    saved: true,
    error: "The saved list did not change. Please try again.",
  });
  assert.deepEqual(nextSaveState(true, false, { ok: true, saved: false }), {
    saved: false,
    error: null,
  });
});

test("a place link is pending, deduped, and never a public listing", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "diner");
  sqlite
    .prepare(
      `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed)
       VALUES (?, 'Dishoom', 'london', 'u', '5 Stable Street', '[]', 's', 'u', 1, 1, 1)`,
    )
    .run(PLACE);
  const duplicate = validatePlaceSubmission({
    mode: "link",
    name: "Dishoom",
    city: "London",
    address: "5 Stable Street",
    sourceUrl: "https://maps.google.com/?q=place_id:ChIJdishoom",
    halalConfirmed: true,
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok || duplicate.data.mode !== "link") return;
  const blocked = await submitPlaceLink("diner", duplicate.data, db);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.place?.id, PLACE);

  const fresh = validatePlaceSubmission({
    mode: "link",
    name: "Missing Kitchen",
    city: "London",
    address: "1 New Street",
    sourceUrl: "https://example.com/missing-kitchen",
    halalConfirmed: true,
  });
  if (!fresh.ok || fresh.data.mode !== "link") throw new Error("link");
  const filed = await submitPlaceLink("diner", fresh.data, db);
  const again = await submitPlaceLink("diner", fresh.data, db);
  assert.equal(filed.ok && again.ok && again.deduped, true);
  if (!filed.ok || !again.ok) return;
  assert.equal(again.id, filed.id);
  assert.equal(filed.status, "pending");
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM places WHERE name = 'Missing Kitchen'`).get() as { n: number }).n,
    0,
  );
  const history = await listContributions("diner", db);
  assert.equal(history[0]?.kind, "link");
  assert.equal(history[0]?.status, "pending");
  assert.equal(history[0]?.placeId, "");
});
