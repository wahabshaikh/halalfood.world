import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareObservations,
  effectiveValidUntil,
  formatObservedAge,
  projectFacts,
  validateObservation,
  type Observation,
} from "../src/observations";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const DAY = 86_400_000;

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: overrides.id ?? `obs-${Math.random().toString(16).slice(2)}`,
    predicate: "telephone",
    value: "+91 22 1111 1111",
    source: "restaurant website",
    sourceClass: "restaurant-owned",
    sourceUrl: null,
    observedAt: NOW - 10 * DAY,
    validUntil: null,
    confidence: "medium",
    ...overrides,
  };
}

test("a published fact always carries its source and observation date", () => {
  const facts = projectFacts([observation()], NOW);
  const fact = facts.get("telephone");
  assert.ok(fact);
  assert.equal(fact.source, "restaurant website");
  assert.equal(fact.sourceClass, "restaurant-owned");
  assert.equal(fact.observedAt, NOW - 10 * DAY);
  assert.equal(fact.stale, false);
});

test("a newer reading is appended, and the older one stays in the history", () => {
  const facts = projectFacts(
    [
      observation({ id: "old", value: "+91 22 1111 1111", observedAt: NOW - 100 * DAY }),
      observation({ id: "new", value: "+91 22 2222 2222", observedAt: NOW - DAY }),
    ],
    NOW,
  );
  const fact = facts.get("telephone");
  assert.equal(fact?.value, "+91 22 2222 2222");
  assert.equal(fact?.history.length, 2);
  // The superseded reading is still readable, in date order.
  assert.deepEqual(
    fact?.history.map((item) => item.id),
    ["new", "old"],
  );
});

test("a stronger source class outranks a fresher weak one", () => {
  const facts = projectFacts(
    [
      observation({
        id: "scrape",
        value: "Closed",
        sourceClass: "search-extraction",
        source: "web extraction",
        observedAt: NOW - DAY,
        predicate: "status",
      }),
      observation({
        id: "official",
        value: "Open",
        sourceClass: "government",
        source: "FSSAI",
        observedAt: NOW - 20 * DAY,
        predicate: "status",
      }),
    ],
    NOW,
  );
  assert.equal(facts.get("status")?.value, "Open");
  assert.equal(facts.get("status")?.source, "FSSAI");
});

test("disagreement is preserved rather than averaged away", () => {
  const facts = projectFacts(
    [
      observation({ id: "a", predicate: "servesAlcohol", value: "no", sourceClass: "restaurant-owned" }),
      observation({ id: "b", predicate: "servesAlcohol", value: "yes", sourceClass: "community" }),
    ],
    NOW,
  );
  const fact = facts.get("servesAlcohol");
  assert.equal(fact?.value, "no");
  assert.equal(fact?.disagreeing.length, 1);
  assert.equal(fact?.disagreeing[0].value, "yes");
});

test("an observation past its validity window is published but flagged stale", () => {
  const facts = projectFacts(
    [observation({ predicate: "openingHours", value: "9-11", observedAt: NOW - 400 * DAY })],
    NOW,
  );
  const fact = facts.get("openingHours");
  assert.equal(fact?.value, "9-11");
  assert.equal(fact?.stale, true);
});

test("validity falls back to a per-predicate duration", () => {
  const hours = observation({ predicate: "openingHours", observedAt: NOW, validUntil: null });
  assert.equal(effectiveValidUntil(hours), NOW + 120 * DAY);
  const unknown = observation({ predicate: "somethingElse", observedAt: NOW, validUntil: null });
  assert.equal(effectiveValidUntil(unknown), NOW + 365 * DAY);
  assert.equal(
    effectiveValidUntil(observation({ observedAt: NOW, validUntil: NOW + DAY })),
    NOW + DAY,
  );
});

test("ranking falls back to confidence and then recency between equal sources", () => {
  const high = observation({ id: "high", confidence: "high", observedAt: NOW - 50 * DAY });
  const low = observation({ id: "low", confidence: "low", observedAt: NOW - DAY });
  assert.ok(compareObservations(high, low) < 0);

  const older = observation({ id: "older", observedAt: NOW - 50 * DAY });
  const newer = observation({ id: "newer", observedAt: NOW - DAY });
  assert.ok(compareObservations(newer, older) < 0);
});

test("an observation is refused without a source, a class or a usable value", () => {
  assert.equal(validateObservation({ predicate: "telephone", value: "x" }, NOW).ok, false);
  assert.equal(
    validateObservation({ predicate: "telephone", value: "x", source: "s" }, NOW).ok,
    false,
  );
  assert.equal(
    validateObservation(
      { predicate: "telephone", value: "x", source: "s", sourceClass: "rumour" },
      NOW,
    ).ok,
    false,
  );
  assert.equal(
    validateObservation(
      { predicate: "telephone", value: "x", source: "s", sourceClass: "community" },
      NOW,
    ).ok,
    true,
  );
});

test("an implausible observation date or a non-http source is refused", () => {
  const base = { predicate: "telephone", value: "x", source: "s", sourceClass: "community" };
  assert.equal(validateObservation({ ...base, observedAt: NOW + 10 * DAY }, NOW).ok, false);
  assert.equal(
    validateObservation({ ...base, sourceUrl: "javascript:alert(1)" }, NOW).ok,
    false,
  );
  assert.equal(
    validateObservation({ ...base, validUntil: NOW - DAY, observedAt: NOW }, NOW).ok,
    false,
  );
});

test("observed age reads as a last-checked line", () => {
  assert.equal(formatObservedAge(NOW, NOW), "checked today");
  assert.equal(formatObservedAge(NOW - 4 * DAY, NOW), "checked 4 days ago");
  assert.equal(formatObservedAge(NOW - 90 * DAY, NOW), "checked 3 months ago");
});
