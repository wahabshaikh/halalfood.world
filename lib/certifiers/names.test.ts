import { test } from "vitest";
import assert from "node:assert/strict";
import { certifierSlug, certifierSlugParam, isRename, matchCertifier, normaliseName, uniqueSlug } from "./names";

test("normalising drops case, accents, punctuation, bracketed abbreviations and trailing legal forms", () => {
  assert.equal(normaliseName("ANIC Halal Authority"), "anic halal authority");
  assert.equal(normaliseName("ANIC Halal Authority Pty. Ltd."), "anic halal authority");
  assert.equal(normaliseName("  American Halal Foundation (AHF) "), "american halal foundation");
  assert.equal(normaliseName("Halal Quality Control [HQC] Group - Scandinavia "), "halal quality control group scandinavia");
  assert.equal(normaliseName("Société Française de Contrôle Halal SARL"), "societe francaise de controle halal sarl");
  assert.equal(normaliseName("Halal Food & Drink Inc."), "halal food and drink");
  assert.equal(normaliseName("Halal Development Company Limited"), "halal development");
  assert.equal(normaliseName("Halal Company Development"), "halal company development", "legal words mid-name stay");
  assert.equal(normaliseName("Ltd"), "ltd", "a name is never reduced to nothing");
});

test("slugs are lowercase hyphenated English names, capped on a word, never a reserved path", () => {
  assert.equal(certifierSlug("ANIC Halal Authority"), "anic-halal-authority");
  assert.equal(certifierSlug("WHAD ITALIA -italian halal certification center "), "whad-italia-italian-halal-certification-center");
  assert.equal(certifierSlug("Société Générale Halal"), "societe-generale-halal");
  const long = certifierSlug("Halal Standard Committee of the Spiritual Board of Muslims of the Republic of Tatarstan Association");
  assert.ok(long.length <= 80);
  assert.ok(!long.endsWith("-"));
  assert.equal(certifierSlug("Methodology"), "methodology-certifier");
  assert.equal(certifierSlug("!!!"), "certifier");
});

test("unique slugs count up from 2", () => {
  assert.equal(uniqueSlug("Halal Body", new Set()), "halal-body");
  assert.equal(uniqueSlug("Halal Body", new Set(["halal-body", "halal-body-2"])), "halal-body-3");
});

test("matching finds a known body through any wording of its name", () => {
  const aliases = new Map([["anic halal authority", "c1"]]);
  assert.equal(matchCertifier("ANIC HALAL AUTHORITY PTY LTD", aliases), "c1");
  assert.equal(matchCertifier("Some New Body", aliases), null);
});

test("a rename is a change in what the name says, not in its spelling", () => {
  assert.equal(isRename("Western Australia Halal Authority ", "Western Australia Halal Authority"), false);
  assert.equal(isRename("ANIC Halal Authority", "anic halal authority pty ltd"), false);
  assert.equal(isRename("ANIC Halal Authority", "Australian National Islamic Council"), true);
});

test("slug params accept only kebab-case", () => {
  assert.equal(certifierSlugParam("ANIC-Halal-Authority"), "anic-halal-authority");
  assert.equal(certifierSlugParam("a--b"), null);
  assert.equal(certifierSlugParam("../etc"), null);
  assert.equal(certifierSlugParam(undefined), null);
  assert.equal(certifierSlugParam("a".repeat(91)), null);
});
