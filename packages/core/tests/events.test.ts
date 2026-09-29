import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVENT_SPAN_MS,
  eventPhase,
  goingLine,
  validateEvent,
  vendorStatusView,
} from "../src/events";

const START = Date.UTC(2026, 9, 2, 13, 10);
const PLACE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const valid = (overrides: Record<string, unknown> = {}) => ({
  title: "Minara Masjid iftar walk",
  citySlug: "mumbai",
  venue: "Mohammed Ali Rd",
  startsAt: START,
  ...overrides,
});

test("an event needs a title, a venue, a city and a start", () => {
  const ok = validateEvent(valid({ endsAt: START + 3_600_000, vendors: [{ name: " Malpua Lane ", note: "Malpua, phirni", placeId: PLACE }, { name: "Stall 14" }] }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.event.vendors, [
    { name: "Malpua Lane", note: "Malpua, phirni", placeId: PLACE },
    { name: "Stall 14", note: null, placeId: null },
  ]);
  assert.equal(validateEvent(valid({ title: " " })).ok, false);
  assert.equal(validateEvent(valid({ venue: "" })).ok, false);
  assert.equal(validateEvent(valid({ citySlug: "Not A Slug" })).ok, false);
  assert.equal(validateEvent(valid({ startsAt: "soon" })).ok, false);
  assert.equal(validateEvent("nope").ok, false);
});

test("an event ends after it starts and within two weeks", () => {
  assert.equal(validateEvent(valid({ endsAt: START - 1 })).ok, false);
  assert.equal(validateEvent(valid({ endsAt: START + MAX_EVENT_SPAN_MS + 1 })).ok, false);
  assert.equal(validateEvent(valid({ endsAt: START + MAX_EVENT_SPAN_MS })).ok, true);
  assert.equal(validateEvent(valid({ endsAt: "whenever" })).ok, false);
  // ISO strings are accepted as start times.
  assert.equal(validateEvent(valid({ startsAt: "2026-10-02T13:10:00Z" })).ok, true);
});

test("vendors need a name and may only link a valid place id", () => {
  assert.equal(validateEvent(valid({ vendors: [{ note: "no name" }] })).ok, false);
  assert.equal(validateEvent(valid({ vendors: [{ name: "Stall", placeId: "nope" }] })).ok, false);
  assert.equal(validateEvent(valid({ vendors: "many" })).ok, false);
  assert.equal(validateEvent(valid({ vendors: Array.from({ length: 201 }, (_, i) => ({ name: `V${i}` })) })).ok, false);
});

test("an event is upcoming, live or past, with six hours assumed when it has no end", () => {
  assert.equal(eventPhase({ startsAt: START, endsAt: null }, START - 1), "upcoming");
  assert.equal(eventPhase({ startsAt: START, endsAt: null }, START), "live");
  assert.equal(eventPhase({ startsAt: START, endsAt: null }, START + 6 * 3_600_000), "live");
  assert.equal(eventPhase({ startsAt: START, endsAt: null }, START + 6 * 3_600_000 + 1), "past");
  assert.equal(eventPhase({ startsAt: START, endsAt: START + 1000 }, START + 2000), "past");
});

test("an unlisted vendor is unverified and the copy never says it is not halal", () => {
  const unlisted = vendorStatusView(undefined);
  assert.equal(unlisted.label, "Unverified");
  assert.equal(unlisted.listed, false);
  assert.doesNotMatch(unlisted.note, /not halal|haram/i);
  assert.match(unlisted.note, /says nothing either way/);

  const listed = vendorStatusView("verified");
  assert.equal(listed.label, "Verified halal");
  assert.equal(listed.listed, true);
  // A place actually marked not halal keeps that label, distinct from unlisted.
  assert.notEqual(vendorStatusView("not-halal").label, unlisted.label);
});

test("the going line names friends first and counts the rest", () => {
  const zaid = { handle: "zaid_bites", displayName: "Zaid Khan" };
  const hafsa = { handle: "hafsa_k", displayName: null };
  assert.equal(goingLine([], 0), null);
  assert.equal(goingLine([], 12), "12 going");
  assert.equal(goingLine([zaid], 1), "Zaid going");
  assert.equal(goingLine([zaid, hafsa], 2), "Zaid and @hafsa_k going");
  assert.equal(goingLine([zaid, hafsa], 66), "Zaid, @hafsa_k and 64 others going");
  assert.equal(goingLine([zaid], 2), "Zaid and 1 other going");
});
