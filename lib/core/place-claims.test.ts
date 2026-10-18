import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CLAIM_ATTRIBUTES,
  attributeFactValue,
  factIsProtected,
  httpsSourceUrl,
  parseStoredClaim,
  planClaim,
  type IncomingClaim,
  type StoredClaim,
} from "./place-claims";

const URL_A = "https://example.com/halal";
const URL_B = "https://example.com/menu";

test("attributes map onto the four facts, inverting pork and alcohol", () => {
  assert.deepEqual(CLAIM_ATTRIBUTES, ["halal_certified", "muslim_owned", "no_pork", "no_alcohol"]);
  assert.equal(attributeFactValue("halal_certified", "yes"), "yes");
  assert.equal(attributeFactValue("halal_certified", "no"), "no");
  assert.equal(attributeFactValue("muslim_owned", "yes"), "yes");
  assert.equal(attributeFactValue("no_pork", "yes"), "no");
  assert.equal(attributeFactValue("no_pork", "no"), "yes");
  assert.equal(attributeFactValue("no_alcohol", "yes"), "no");
  assert.equal(attributeFactValue("no_alcohol", "no"), "yes");
  // Unknown is no claim, never "no".
  for (const attribute of CLAIM_ATTRIBUTES) assert.equal(attributeFactValue(attribute, "unknown"), null);
});

test("source URLs are https only, without credentials", () => {
  assert.equal(httpsSourceUrl(" https://Example.com/a?b=1 "), "https://example.com/a?b=1");
  assert.equal(httpsSourceUrl("http://example.com"), null);
  assert.equal(httpsSourceUrl("javascript:alert(1)"), null);
  assert.equal(httpsSourceUrl("https://user:pw@example.com"), null);
  assert.equal(httpsSourceUrl("not a url"), null);
  assert.equal(httpsSourceUrl(`https://example.com/${"a".repeat(500)}`), null);
});

test("a fact is protected by checks and reviewed documents, not by listings or web claims", () => {
  assert.equal(factIsProtected({ value: "yes", sources: ["community"] }), true);
  assert.equal(factIsProtected({ value: "yes", sources: ["certificate"] }), true);
  assert.equal(factIsProtected({ value: "no", sources: ["menu", "listing"] }), true);
  assert.equal(factIsProtected({ value: "no", sources: ["listing"] }), false);
  assert.equal(factIsProtected({ value: "no", sources: ["scout"] }), false);
  assert.equal(factIsProtected({ value: null, sources: [] }), false);
  assert.equal(factIsProtected({ value: "yes", sources: [], disputed: true }), true);
});

const incoming = (over: Partial<IncomingClaim> = {}): IncomingClaim => ({ fact: "certified", value: "yes", sourceUrl: URL_A, certifier: "HMC", ...over });
const stored = (over: Partial<StoredClaim> = {}): StoredClaim => ({ fact: "certified", value: "yes", sourceUrl: URL_A, certifier: "HMC", ...over });

test("planClaim: set, unchanged, updated", () => {
  assert.deepEqual(planClaim(incoming(), null, false), { outcome: "set", write: stored() });
  assert.deepEqual(planClaim(incoming(), stored(), false), { outcome: "unchanged", write: null });
  assert.deepEqual(planClaim(incoming({ value: "no" }), stored(), false), { outcome: "updated", write: stored({ value: "no", certifier: null }) });
  assert.deepEqual(planClaim(incoming({ sourceUrl: URL_B }), stored(), false), { outcome: "updated", write: stored({ sourceUrl: URL_B }) });
  assert.deepEqual(planClaim(incoming({ certifier: "HFA" }), stored(), false), { outcome: "updated", write: stored({ certifier: "HFA" }) });
  // A certifier never sticks to anything but certified = yes.
  assert.deepEqual(planClaim(incoming({ fact: "pork", value: "no" }), null, false).write, { fact: "pork", value: "no", sourceUrl: URL_A, certifier: null });
});

test("planClaim: checks and documents win, and unknown clears only Scout's own claim", () => {
  assert.deepEqual(planClaim(incoming(), null, true), { outcome: "kept_existing", write: null });
  assert.deepEqual(planClaim(incoming({ value: "no" }), stored(), true), { outcome: "kept_existing", write: null });
  assert.deepEqual(planClaim(incoming({ value: null, sourceUrl: null }), stored(), false), { outcome: "cleared", write: "delete" });
  assert.deepEqual(planClaim(incoming({ value: null, sourceUrl: null }), stored(), true), { outcome: "cleared", write: "delete" });
  assert.deepEqual(planClaim(incoming({ value: null, sourceUrl: null }), null, false), { outcome: "unchanged", write: null });
});

test("parseStoredClaim skips rows that aren't a yes/no on one of the four facts", () => {
  assert.deepEqual(parseStoredClaim({ fact: "pork", value: "no", source_url: URL_A, certifier: null }), { fact: "pork", value: "no", sourceUrl: URL_A, certifier: null });
  assert.deepEqual(parseStoredClaim({ fact: "certified", value: "yes", source_url: URL_A, certifier: "HMC" })?.certifier, "HMC");
  assert.equal(parseStoredClaim({ fact: "rating", value: "yes", source_url: URL_A }), null);
  assert.equal(parseStoredClaim({ fact: "pork", value: "unknown", source_url: URL_A }), null);
  assert.equal(parseStoredClaim({ fact: "pork", value: "no", source_url: null }), null);
});
