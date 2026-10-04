import assert from "node:assert/strict";
import test from "node:test";
import type { CityCoverage } from "@halalfood/core/coverage";

import { loadCachedCityCoverage } from "../src/lib/city-coverage-read";
import { clearReadCache } from "../src/lib/read-cache";
import { cityEvidencePhrase } from "../src/lib/seo";

const coverage: CityCoverage = {
  citySlug: "mumbai",
  total: 2,
  indexed: 1,
  enriched: 1,
  intelligent: 0,
  trusted: 0,
  enrichedPercent: 50,
  requests: 0,
  contributors: 0,
};

test("a failed city coverage lookup is not cached", async () => {
  clearReadCache();
  let loads = 0;
  const load = async () => {
    loads += 1;
    if (loads === 1) throw new Error("D1 unavailable");
    return coverage;
  };

  await assert.rejects(loadCachedCityCoverage("mumbai", load), /D1 unavailable/);
  // The rejection handler drops the in-memory entry on a later turn.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(await loadCachedCityCoverage("mumbai", load), coverage);
  assert.equal(await loadCachedCityCoverage("mumbai", load), coverage);
  assert.equal(loads, 2);
  assert.equal(cityEvidencePhrase(null), "Evidence status could not be loaded");
});
