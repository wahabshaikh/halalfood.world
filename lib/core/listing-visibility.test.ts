import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayCuisines,
  hiddenListingReason,
} from "./listing-visibility";

test("beer halls, pubs, wine bars and taverns are hidden, taverna restaurants are not", () => {
  const hidden = [
    "Hofbräuhaus München",
    "Caru' cu bere",
    "Kirin Beer Garden in Urban Sapporo Building",
    "Valais-style Tavern",
    "Flight Restaurant and Wine Bar",
    "East India Company Pub & Eatery",
    "Shawarma Beer Club",
    "Gami Chicken & beer",
    "Arash Pub アラシ パブ",
  ];
  for (const name of hidden) assert.equal(hiddenListingReason({ name }), "name", name);

  for (const name of [
    "Lebanese Taverna",
    "La Taverna Lagos",
    "Ottoman Taverna",
    "ChickHEN Republic Mount Wellington",
    "Bengal Brasserie",
    "Chara Brasserie (HALAL KITCHEN)",
    "Estabulo Rodizio Bar & Grill - Leeds",
    "Fazenda Rodizio Bar & Grill Manchester",
  ]) {
    assert.equal(hiddenListingReason({ name }), null, name);
  }
});

test("bar and grill hides only when another signal agrees, and the audit id is explicit", () => {
  assert.equal(hiddenListingReason({ name: "Shivas Bar and Grill" }), null);
  assert.equal(
    hiddenListingReason({ name: "Shivas Bar and Grill", types: ["restaurant", "bar"] }),
    "bar-and-grill",
  );
  assert.equal(
    hiddenListingReason({
      id: "65992004-f61e-42b3-b4ea-2b7f9e8908ef",
      name: "Shivas Bar and Grill",
    }),
    "launch-audit",
  );
  assert.equal(hiddenListingReason({ name: "Tanatan", types: ["bar", "restaurant"] }), null);
  assert.equal(hiddenListingReason({ name: "A Brewery Tap", types: ["brewery"] }), "name");
  assert.equal(hiddenListingReason({ name: "Corner Kitchen", types: ["pub"] }), "google-type");
});

test("Halal is not a cuisine label", () => {
  assert.deepEqual(displayCuisines(["Halal"]), []);
  assert.deepEqual(displayCuisines(["Indian", "Halal"]), ["Indian"]);
  assert.deepEqual(displayCuisines(null), []);
});
