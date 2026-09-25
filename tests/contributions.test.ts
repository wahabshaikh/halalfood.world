import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMergePlan,
  editModerationDecision,
  validateDish,
  validateDuplicateReport,
  validateEditSuggestion,
} from "../src/lib/contributions";

const PLACE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

test("a correction needs a known field and a value", () => {
  assert.equal(validateEditSuggestion({ field: "vibes", proposedValue: "x" }).ok, false);
  assert.equal(validateEditSuggestion({ field: "telephone", proposedValue: "" }).ok, false);
  assert.equal(
    validateEditSuggestion({ field: "telephone", proposedValue: "+91 22 1234 5678" }).ok,
    true,
  );
});

test("a halal-sensitive correction cannot be submitted without provenance", () => {
  const bare = validateEditSuggestion({
    field: "servesAlcohol",
    proposedValue: "no",
  });
  assert.equal(bare.ok, false);
  if (!bare.ok) assert.match(bare.error, /source link or an explanation/);

  const sourced = validateEditSuggestion({
    field: "servesAlcohol",
    proposedValue: "no",
    sourceUrl: "https://example.com/menu",
  });
  assert.equal(sourced.ok, true);
});

test("a source must be an http(s) link", () => {
  assert.equal(
    validateEditSuggestion({
      field: "website",
      proposedValue: "https://example.com",
      sourceUrl: "javascript:alert(1)",
    }).ok,
    false,
  );
});

test("halal-sensitive edits always queue, however reliable the contributor", () => {
  const decision = editModerationDecision({
    field: "dedicatedHalalKitchen",
    relationship: "none",
    acceptedContributions: 500,
    rejectedContributions: 0,
  });
  assert.equal(decision.autoAccept, false);
  assert.match(decision.reason, /halal conclusion/);
});

test("low-risk edits auto-accept only for a proven contributor with no relationship", () => {
  const reliable = editModerationDecision({
    field: "telephone",
    relationship: "none",
    acceptedContributions: 8,
    rejectedContributions: 0,
  });
  assert.equal(reliable.autoAccept, true);

  const newcomer = editModerationDecision({
    field: "telephone",
    relationship: "none",
    acceptedContributions: 1,
    rejectedContributions: 0,
  });
  assert.equal(newcomer.autoAccept, false);

  const interested = editModerationDecision({
    field: "telephone",
    relationship: "owner",
    acceptedContributions: 100,
    rejectedContributions: 0,
  });
  assert.equal(interested.autoAccept, false);

  const inaccurate = editModerationDecision({
    field: "telephone",
    relationship: "none",
    acceptedContributions: 6,
    rejectedContributions: 3,
  });
  assert.equal(inaccurate.autoAccept, false);
});

test("a dish carries a normalized name and validated price", () => {
  const ok = validateDish({
    name: "Chicken Biryani",
    priceMinor: 32000,
    currency: "INR",
    halalScope: "halal",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.data.normalizedName, "chicken biryani");

  assert.equal(validateDish({ name: "Biryani", priceMinor: 32000 }).ok, false);
  assert.equal(validateDish({ name: "  " }).ok, false);
  assert.equal(validateDish({ name: "Biryani", halalScope: "probably" }).ok, false);
});

test("a duplicate report must point at a different, valid place", () => {
  assert.equal(validateDuplicateReport(PLACE_ID, { duplicateOfPlaceId: PLACE_ID }).ok, false);
  assert.equal(validateDuplicateReport(PLACE_ID, { duplicateOfPlaceId: "nope" }).ok, false);
  assert.equal(
    validateDuplicateReport(PLACE_ID, { duplicateOfPlaceId: OTHER_ID }).ok,
    true,
  );
});

test("a merge plan moves every table that would otherwise lose data", () => {
  const plan = buildMergePlan(PLACE_ID, OTHER_ID);
  const tables = plan.moves.map((move) => move.table);
  for (const table of [
    "place_halal_verifications",
    "place_visits",
    "place_check_ins",
    "place_dishes",
    "place_photos",
    "saved_places",
    "place_list_items",
  ])
    assert.ok(tables.includes(table), `${table} must be moved on merge`);
});
