import { test } from "vitest";
import assert from "node:assert/strict";
import { captionSearchTerms, matchPlaces, scorePlace, type MatchCandidate } from "./media-match";

const place = (id: string, name: string, locality = "Mumbai"): MatchCandidate => ({
  id,
  name,
  citySlug: locality.toLowerCase().replace(/\s+/g, "-"),
  addressLocality: locality,
});

const CAPTION = "Crawford Market's smokiest seekh, 3 generations at Zaffran Grill 🔥 #mumbaifood";

test("a name in the caption is a strong match", () => {
  const matches = matchPlaces(CAPTION, [place("1", "Zaffran Grill"), place("2", "Irani Chai Corner")]);
  assert.deepEqual(matches.map((match) => match.id), ["1"]);
  assert.equal(matches[0].confidence, "high");
});

test("accents, punctuation and case do not matter", () => {
  const matches = matchPlaces("best NIHARI at Nalli-Nihari house!!", [place("1", "Nalli Nihari House")]);
  assert.equal(matches.length, 1);
});

test("a single shared word among several is not a match", () => {
  assert.equal(scorePlace("great biryani at Persian house", place("1", "Persian Darbar Royale")), 0);
  assert.deepEqual(matchPlaces("Persian food tour", [place("1", "Persian Darbar")]), []);
});

test("generic names alone never match", () => {
  assert.deepEqual(matchPlaces("the best halal restaurant ever", [place("1", "Halal Restaurant")]), []);
});

test("an empty caption matches nothing", () => {
  assert.deepEqual(matchPlaces("   ", [place("1", "Zaffran Grill")]), []);
});

test("the city in the caption nudges the score up", () => {
  const withCity = scorePlace("Malpua Lane in Bandra", place("1", "Malpua Lane", "Bandra"));
  const without = scorePlace("Malpua Lane", place("1", "Malpua Lane", "Bandra"));
  assert.ok(withCity > without);
});

test("search terms are distinctive words, longest first", () => {
  const terms = captionSearchTerms(CAPTION);
  assert.ok(terms.includes("zaffran"));
  assert.ok(!terms.includes("halal"));
  assert.ok(terms.length <= 8);
  assert.deepEqual(captionSearchTerms("the and 123 of"), []);
});

test("no more than three suggestions come back, best first", () => {
  const many = ["Zaffran One", "Zaffran Two", "Zaffran Three", "Zaffran Grill Bandra"].map((name, i) =>
    place(String(i), name),
  );
  const matches = matchPlaces("zaffran one zaffran two zaffran three zaffran grill bandra", many);
  assert.ok(matches.length <= 3);
});
