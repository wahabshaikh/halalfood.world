import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUIDE_SELECTION_NOTE,
  guideDescription,
  guideKicker,
  guidePath,
  guideTitle,
} from "../src/lib/guides";

test("guide helpers produce stable, crawlable city paths", () => {
  assert.equal(guidePath("new-york-city"), "/guides/new-york-city");
  assert.equal(guideTitle("new-york-city"), "A halal food guide to New York City");
});

test("guide copy explains the ranking and evidence boundary", () => {
  const city = {
    city_slug: "london",
    place_count: 42,
    address_country: "United Kingdom",
  };
  assert.match(guideDescription(city), /42 listed places/);
  assert.equal(guideKicker(city), "London · United Kingdom");
  assert.match(GUIDE_SELECTION_NOTE, /not paid placements/);
});
