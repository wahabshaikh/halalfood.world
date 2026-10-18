import assert from "node:assert/strict";
import { test } from "vitest";
import { ingestRejection } from "./ingest-filters";

test("Ahmadiyya places are refused", () => {
  for (const name of [
    "Ahmadiyya Muslim Community Glasgow",
    "Baitul Futuh Mosque",
    "Bait-ul-Futuh Langar",
    "AHMADIYYA ANJUMAN ISHAAT-I-ISLAM LAHORE",
    "Qadiani Jamaat Hall",
    "Lahori Ahmadiyya Movement",
    "Jalsa Salana Food Court",
    "Ahmadi Muslim Mosque",
    "Ahmadiyyah Centre",
  ])
    assert.equal(ingestRejection({ name })?.rejected, "ahmadiyya", name);
  assert.equal(ingestRejection({ name: "Community Langar", description: "Run by the Ahmadiyya Muslim Jamaat" })?.rejected, "ahmadiyya");
});

test("Ahmadi on its own is a surname, not a community", () => {
  assert.equal(ingestRejection({ name: "Ahmadi Kabob House" }), null);
  assert.equal(ingestRejection({ name: "Lahori Karahi" }), null);
  assert.equal(ingestRejection({ name: "Al-Futuh Grill" }), null);
});

test("alcohol-led places are refused with the listing rule", () => {
  for (const name of ["The Red Lion Pub", "Beer Hall Mitte", "Vino Wine Bar", "Camden Brewery"])
    assert.equal(ingestRejection({ name })?.rejected, "alcohol_led", name);
  assert.equal(ingestRejection({ name: "The Crown", types: ["Pub"] })?.rejected, "alcohol_led");
  assert.equal(ingestRejection({ name: "Kingsway", types: ["wine bar"] })?.rejected, "alcohol_led");
  assert.match(ingestRejection({ name: "Red Lion Pub" })!.reason, /pub, bar/);
});

test("ordinary halal places pass", () => {
  assert.equal(ingestRejection({ name: "Taverna Halal Grill" }), null);
  assert.equal(ingestRejection({ name: "Dishoom", description: "Bombay cafe next to the old pub", types: ["Indian"] }), null);
  assert.equal(ingestRejection({ name: "Salt Bae", types: null }), null);
});
