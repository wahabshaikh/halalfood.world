import { test } from "vitest";
import assert from "node:assert/strict";
import { BPJPH_SCOPE_MAP, SCOPE_LABELS, isScopeCode, mapBpjphScopes, scopeLabel, splitBpjphScopes } from "./scopes";

test("BPJPH scope wording maps to our codes in vocabulary order, case variants included", () => {
  assert.deepEqual(mapBpjphScopes("Slaughtering Services|Food|Chemical Products|Drugs"), {
    scopes: ["food", "meat_slaughter", "drugs_pharma", "chemicals"],
    unmapped: [],
  });
  assert.deepEqual(mapBpjphScopes("food|FOOD|Space travel"), { scopes: ["food"], unmapped: ["Space travel"] });
  assert.deepEqual(mapBpjphScopes(null), { scopes: [], unmapped: [] });
  for (const code of Object.values(BPJPH_SCOPE_MAP)) assert.ok(isScopeCode(code));
});

test("splitting and labels", () => {
  assert.deepEqual(splitBpjphScopes(" Food | |Beverages"), ["Food", "Beverages"]);
  assert.equal(scopeLabel("drugs_pharma"), SCOPE_LABELS.drugs_pharma);
  assert.equal(scopeLabel("unknown"), "unknown");
  assert.equal(isScopeCode("toString"), false);
});
