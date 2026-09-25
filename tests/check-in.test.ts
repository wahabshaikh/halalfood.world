import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_PUBLISHABLE_SAMPLE,
  countsTowardsRanking,
  normalizeDishName,
  summarizeCheckIns,
  summarizeDishes,
  validateCheckIn,
  type CheckInRecord,
} from "../src/lib/check-in";

function record(overrides: Partial<CheckInRecord> = {}): CheckInRecord {
  return {
    wouldReturn: "definitely",
    valueVerdict: "fair",
    verified: true,
    ...overrides,
  };
}

test("a minimal check-in is would-return plus value", () => {
  const result = validateCheckIn({ wouldReturn: "maybe", valueVerdict: "great" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.wouldReturn, "maybe");
  assert.equal(result.data.relationship, "none");
  assert.equal(result.data.incentivized, false);
  assert.deepEqual(result.data.dishes, []);
});

test("check-in rejects missing or unknown answers", () => {
  for (const body of [
    {},
    { wouldReturn: "sometimes", valueVerdict: "fair" },
    { wouldReturn: "no", valueVerdict: "cheap" },
    { wouldReturn: "no", valueVerdict: "fair", wouldBringFriend: "perhaps" },
  ]) {
    const result = validateCheckIn(body);
    assert.equal(result.ok, false, JSON.stringify(body));
  }
});

test("a spend amount must carry a currency", () => {
  const missing = validateCheckIn({
    wouldReturn: "no",
    valueVerdict: "overpriced",
    spendMinor: 45000,
  });
  assert.equal(missing.ok, false);

  const complete = validateCheckIn({
    wouldReturn: "no",
    valueVerdict: "overpriced",
    spendMinor: 45000,
    currency: "INR",
  });
  assert.equal(complete.ok, true);
});

test("dish verdicts are validated and de-duplicated by normalized name", () => {
  const duplicate = validateCheckIn({
    wouldReturn: "definitely",
    valueVerdict: "fair",
    dishes: [
      { name: "Chicken Biryani", verdict: "order-again" },
      { name: "chicken  biryani", verdict: "avoid" },
    ],
  });
  assert.equal(duplicate.ok, false);

  const valid = validateCheckIn({
    wouldReturn: "definitely",
    valueVerdict: "fair",
    dishes: [{ name: "Mutton Seekh", verdict: "order-again" }],
  });
  assert.equal(valid.ok, true);
});

test("visit context only accepts known keys and values", () => {
  assert.equal(
    validateCheckIn({
      wouldReturn: "maybe",
      valueVerdict: "fair",
      context: { service: "dine-in", meal: "dinner" },
    }).ok,
    true,
  );
  assert.equal(
    validateCheckIn({
      wouldReturn: "maybe",
      valueVerdict: "fair",
      context: { service: "teleport" },
    }).ok,
    false,
  );
});

test("dish names fold to a stable key across contributors", () => {
  assert.equal(normalizeDishName("Chicken  Biryani!"), "chicken biryani");
  assert.equal(normalizeDishName("Döner Kebab"), "doner kebab");
});

test("a sample below the publishable threshold reports counts, not a percentage", () => {
  const summary = summarizeCheckIns([record(), record(), record()]);
  assert.equal(summary.verified.count, 3);
  assert.equal(summary.verified.insufficientData, true);
  assert.equal(summary.verified.wouldReturnPercent, null);
});

test("verified and unverified experience never merge into one number", () => {
  const records = [
    ...Array.from({ length: MIN_PUBLISHABLE_SAMPLE }, () => record()),
    ...Array.from({ length: MIN_PUBLISHABLE_SAMPLE }, () =>
      record({ verified: false, wouldReturn: "no" }),
    ),
  ];
  const summary = summarizeCheckIns(records);
  assert.equal(summary.verified.wouldReturnPercent, 100);
  assert.equal(summary.unverified.wouldReturnPercent, 0);
});

test("rewarded and connected feedback is excluded from the aggregate", () => {
  const summary = summarizeCheckIns([
    record({ incentivized: true }),
    record({ relationship: "owner" }),
    record(),
  ]);
  assert.equal(summary.excludedCount, 2);
  assert.equal(summary.verified.count, 1);
  assert.equal(countsTowardsRanking(record({ incentivized: true })), false);
  assert.equal(countsTowardsRanking(record({ relationship: "staff" })), false);
  assert.equal(countsTowardsRanking(record()), true);
});

test("median spend is reported only from the records that carry one", () => {
  const summary = summarizeCheckIns([
    record({ spendMinor: 30000, currency: "INR" }),
    record({ spendMinor: 50000, currency: "INR" }),
    record({ spendMinor: 40000, currency: "INR" }),
    record(),
  ]);
  assert.equal(summary.medianSpendMinor, 40000);
  assert.equal(summary.currency, "INR");
});

test("dish highlights separate most ordered, recommended and avoided", () => {
  const verdicts = [
    ...Array.from({ length: 6 }, () => ({
      name: "Biryani",
      normalizedName: "biryani",
      verdict: "order-again" as const,
    })),
    ...Array.from({ length: 4 }, () => ({
      name: "Fries",
      normalizedName: "fries",
      verdict: "avoid" as const,
    })),
    { name: "Kunafa", normalizedName: "kunafa", verdict: "fine" as const },
  ];
  const highlights = summarizeDishes(verdicts);
  assert.equal(highlights.mostOrdered[0].name, "Biryani");
  assert.equal(highlights.mostRecommended[0].name, "Biryani");
  assert.equal(highlights.mostRecommended[0].orderAgainPercent, 100);
  assert.equal(highlights.commonlyAvoided[0].name, "Fries");
  // Kunafa has one verdict, below the per-dish sample floor.
  assert.equal(
    highlights.mostOrdered.find((dish) => dish.name === "Kunafa")?.orderAgainPercent,
    null,
  );
});

test("dish highlights report an insufficient-data state on a thin sample", () => {
  const highlights = summarizeDishes([
    { name: "Biryani", normalizedName: "biryani", verdict: "order-again" },
  ]);
  assert.equal(highlights.insufficientData, true);
  assert.deepEqual(highlights.mostRecommended, []);
});
