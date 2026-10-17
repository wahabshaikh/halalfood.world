import { test } from "vitest";
import assert from "node:assert/strict";
import type { RecognitionRow, Source } from "./repository";
import { basedIn, basedInCountries, certifierJson, directoryEntries, groupByCertifier, tableRows } from "./views";
import { importingCountry, importingCountryForAuthority } from "./importing";
import { certifierJsonLd, certifierTitle, countryDatasetJsonLd, countryPageTitle, hubTitle } from "./seo";

function rec(overrides: Partial<RecognitionRow> = {}): RecognitionRow {
  return {
    recognitionId: "r1",
    certifierId: "c1",
    slug: "anic-halal-authority",
    name: "ANIC Halal Authority",
    countryCode: "AU",
    city: "Chullora 2190",
    address: "LEVEL 2",
    authorityId: "bpjph",
    status: "recognised",
    scopes: ["food"],
    scopesRaw: "Food",
    sourceRef: "REG 1",
    sourceStatus: "MRA",
    validUntil: "2030-06-30",
    lastCheckedAt: Date.UTC(2026, 9, 17, 10),
    updatedAt: Date.UTC(2026, 9, 17, 10),
    ...overrides,
  };
}

const sources: Source[] = [
  { id: "bpjph-lhln", authorityId: "bpjph", url: "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri", lastCheckedAt: 1, lastOkAt: 1, needsLook: false, lastError: null },
];

test("rows group into one entry per certifier, sorted by name", () => {
  const groups = groupByCertifier([rec({ certifierId: "c2", slug: "b", name: "beta" }), rec(), rec({ certifierId: "c3", slug: "c", name: "Alpha", countryCode: null })]);
  assert.deepEqual(groups.map((group) => group.name), ["Alpha", "ANIC Halal Authority", "beta"]);
  assert.deepEqual(basedInCountries(groups), [{ code: "AU", name: "Australia", count: 2 }]);
  const [entry] = directoryEntries([groups[1]], new Map([["c1", ["anic halal authority"]]]), "2031-01-01");
  assert.deepEqual(entry.cells.indonesia, { status: "expired", validText: "Expired 30 Jun 2030 (official list's own date)", scopes: ["food"] });
  assert.deepEqual(entry.aliases, ["anic halal authority"]);
  assert.equal(directoryEntries([{ ...groups[1], recognitions: {} }], new Map(), "2026-10-17")[0].cells.indonesia, null);
});

test("table rows and JSON carry the official date, status and source", () => {
  const [row] = tableRows([rec({ validUntil: null })], "2026-10-17");
  assert.equal(row.validText, "No date on official list");
  assert.equal(row.countryName, "Australia");
  const json = certifierJson(rec(), [rec()], sources, "2026-10-17");
  assert.equal(json.url, "https://halalfood.world/certifiers/anic-halal-authority");
  assert.deepEqual(json.recognitions[0], {
    authority: "bpjph",
    importingCountry: "ID",
    status: "recognised",
    sourceStatus: "MRA",
    scopes: ["food"],
    scopesRaw: "Food",
    validUntil: "2030-06-30",
    registrationNumber: "REG 1",
    officialList: sources[0].url,
    lastCheckedAt: "2026-10-17T10:00:00.000Z",
  });
  assert.equal(certifierJson(rec(), [rec({ authorityId: "jakim" })], [], "2026-10-17").recognitions[0].officialList, null);
  assert.equal(basedIn(null, null), "Not given");
  assert.equal(basedIn("Tampa", "US"), "Tampa, United States");
});

test("titles say when the list was checked and end with the site name", () => {
  const indonesia = importingCountry("indonesia")!;
  assert.equal(countryPageTitle(indonesia, Date.UTC(2026, 9, 17, 10)), "BPJPH recognised foreign halal certification bodies (updated 17 Oct 2026) | halalfood.world");
  assert.equal(countryPageTitle(indonesia, null), "BPJPH recognised foreign halal certification bodies | halalfood.world");
  assert.equal(hubTitle(Date.UTC(2026, 9, 17)), "Halal certifiers accepted by importing countries (updated 17 Oct 2026) | halalfood.world");
  assert.equal(hubTitle(null), "Halal certifiers accepted by importing countries | halalfood.world");
  const short = (id: string) => importingCountryForAuthority(id)?.authorityShort ?? id;
  assert.equal(certifierTitle("ANIC Halal Authority", [rec()], short), "ANIC Halal Authority: recognised by BPJPH until 30 Jun 2030 | halalfood.world");
  assert.equal(certifierTitle("X", [rec({ status: "removed" })], short), "X: halal certifier recognition | halalfood.world");
  assert.equal(importingCountry("mars"), null);
  assert.equal(importingCountryForAuthority("jakim"), null);
});

test("JSON-LD: a Dataset for the country list and an Organization with only what the list says", () => {
  const dataset = countryDatasetJsonLd(importingCountry("indonesia")!, { officialUrl: sources[0].url, count: 124, modifiedAt: Date.UTC(2026, 9, 17), checkedAt: null });
  assert.equal(dataset["@type"], "Dataset");
  assert.equal(dataset.isBasedOn, sources[0].url);
  assert.equal(dataset.distribution[0].contentUrl, "https://halalfood.world/certifiers/country/indonesia.csv");
  const org = certifierJsonLd({ slug: "anic-halal-authority", name: "ANIC Halal Authority", countryCode: "AU", city: "Chullora 2190", address: null, website: null });
  assert.equal(org["@type"], "Organization");
  assert.deepEqual(org.address, { "@type": "PostalAddress", streetAddress: undefined, addressLocality: "Chullora 2190", addressCountry: "AU" });
  assert.equal(org.sameAs, undefined);
  assert.equal(certifierJsonLd({ slug: "x", name: "X", countryCode: null, city: null, address: null, website: "https://x.org" }).address, undefined);
});
