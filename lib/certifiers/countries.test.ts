import { test } from "vitest";
import assert from "node:assert/strict";
import { BPJPH_COUNTRY_CODES, COUNTRY_NAMES, bpjphCountryCode, countryCodeFromSlug, countryName, countrySlug } from "./countries";

test("BPJPH's own spellings map to ISO codes, and every code has an English name", () => {
  assert.equal(bpjphCountryCode("Polandia"), "PL");
  assert.equal(bpjphCountryCode("Kolombia"), "CO");
  assert.equal(bpjphCountryCode("United States of America"), "US");
  assert.equal(bpjphCountryCode(" south korea "), "KR");
  assert.equal(bpjphCountryCode("Atlantis"), null);
  assert.equal(bpjphCountryCode(null), null);
  for (const code of Object.values(BPJPH_COUNTRY_CODES)) assert.ok(COUNTRY_NAMES[code], code);
});

test("country slugs round-trip", () => {
  assert.equal(countryName("GB"), "United Kingdom");
  assert.equal(countryName(null), null);
  assert.equal(countrySlug("US"), "united-states");
  assert.equal(countrySlug("XX"), null);
  assert.equal(countryCodeFromSlug("united-states"), "US");
  assert.equal(countryCodeFromSlug("South-Korea"), "KR");
  assert.equal(countryCodeFromSlug("narnia"), null);
  assert.equal(countryCodeFromSlug(undefined), null);
});
