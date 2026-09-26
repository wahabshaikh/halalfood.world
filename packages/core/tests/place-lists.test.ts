import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LIST_ITEMS,
  slugifyListTitle,
  unvisitedRankedEntries,
  validateList,
  validateListItems,
} from "../src/place-lists";
import {
  displayFacts,
  mapPlaceFacts,
  priceBandLabel,
} from "../src/place-facts";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

test("a list needs a title and defaults to a public ranked list", () => {
  assert.equal(validateList({}).ok, false);
  const result = validateList({ title: "Top biryani in Mumbai" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.slug, "top-biryani-in-mumbai");
  assert.equal(result.data.ranked, true);
  assert.equal(result.data.visibility, "public");
});

test("slugs stay URL-safe and never end up empty", () => {
  assert.equal(slugifyListTitle("  Bandra's  BEST!  "), "bandra-s-best");
  assert.equal(slugifyListTitle("!!!"), "list");
});

test("list items are validated, de-duplicated and position-free", () => {
  assert.equal(validateListItems("not an array").ok, false);
  assert.equal(validateListItems([{ placeId: "nope" }]).ok, false);
  assert.equal(
    validateListItems([{ placeId: PLACE_ID }, { placeId: PLACE_ID }]).ok,
    false,
  );
  assert.equal(
    validateListItems(Array.from({ length: MAX_LIST_ITEMS + 1 }, () => PLACE_ID)).ok,
    false,
  );

  const result = validateListItems([PLACE_ID, { placeId: OTHER_ID, note: "Get the kunafa" }]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, [
    { placeId: PLACE_ID, note: null },
    { placeId: OTHER_ID, note: "Get the kunafa" },
  ]);
});

test("a published ranked list may only contain confirmed visits", () => {
  const missing = unvisitedRankedEntries(
    [{ placeId: PLACE_ID }, { placeId: OTHER_ID }],
    new Set([PLACE_ID]),
  );
  assert.deepEqual(missing, [OTHER_ID]);
  assert.deepEqual(
    unvisitedRankedEntries([{ placeId: PLACE_ID }], new Set([PLACE_ID])),
    [],
  );
});

test("a missing facts row is an all-unknown facts row, not an error", () => {
  const facts = mapPlaceFacts(PLACE_ID, null);
  assert.equal(facts.servesAlcohol, "unknown");
  assert.equal(facts.certificationBody, null);
  assert.deepEqual(facts.serviceTypes, []);
});

test("facts are mapped independently and unknowns sort last", () => {
  const facts = mapPlaceFacts(PLACE_ID, {
    serves_alcohol: "no",
    serves_pork: "no",
    dedicated_halal_kitchen: "unknown",
    muslim_owned: "yes",
    prayer_space: "unknown",
    women_friendly_facilities: "unknown",
    vegetarian_options: "yes",
    certification_body: "Some Body",
    price_band: 2,
    service_types: '["dine-in","delivery"]',
    meals: '["lunch"]',
  });
  assert.equal(facts.priceBand, 2);
  assert.deepEqual(facts.serviceTypes, ["dine-in", "delivery"]);

  const display = displayFacts(facts);
  assert.equal(display[0].value !== "unknown", true);
  assert.equal(display[display.length - 1].value, "unknown");
  const alcohol = display.find((entry) => entry.key === "servesAlcohol");
  assert.equal(alcohol?.label, "No alcohol served");
  assert.equal(alcohol?.reassuring, true);
});

test("an out-of-range price band is dropped rather than displayed", () => {
  assert.equal(mapPlaceFacts(PLACE_ID, { price_band: 9 }).priceBand, null);
  assert.equal(priceBandLabel(3), "$$$");
  assert.equal(priceBandLabel(null), null);
});
