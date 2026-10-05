import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_AGE_MS,
  deriveStatus,
  factAnswerLabel,
  factEvidence,
  factState,
  factTags,
  factTone,
  listingFacts,
  matchesFilters,
  parseFilters,
  parseListingClaim,
  parseSources,
  formatSources,
  placeStatus,
  resolveFact,
  statusLabel,
  type Answer,
  type CheckForStatus,
  type Facts,
  type Signal,
} from "../src/halal";

const settled = (value: "yes" | "no", streak = 3) => ({ value, streak, settled: true });
const partial = (value: "yes" | "no", streak: 1 | 2) => ({ value, streak: streak, settled: false });
const none = { value: null, streak: 0, settled: false };

test("factState: newest definite answers form the streak", () => {
  const cases: [Answer[], ReturnType<typeof factState>][] = [
    [[], none],
    [["unsure", null], none],
    [["yes"], partial("yes", 1)],
    [["yes", "yes"], partial("yes", 2)],
    [["yes", "unsure", "yes", "yes"], settled("yes")],
    [["yes", null, "yes", "yes"], settled("yes")],
    [["no", "yes", "yes", "yes"], partial("no", 1)],
    [["yes", "yes", "no"], partial("yes", 2)],
    [["no", "no", "no", "no", "yes"], settled("no", 4)],
    [Array(7).fill("yes"), settled("yes", 7)],
  ];
  for (const [answers, expected] of cases) assert.deepEqual(factState(answers), expected, JSON.stringify(answers));
});

test("placeStatus: verified needs all four facts settled", () => {
  const all: Facts = { owned: settled("yes"), certified: settled("yes"), pork: settled("no"), alcohol: settled("no") };
  assert.deepEqual(placeStatus(all, 3), { kind: "verified" });
  assert.deepEqual(placeStatus({ ...all, certified: none }, 3), { kind: "checking", progress: 2 });
  assert.deepEqual(placeStatus({ ...all, owned: partial("yes", 1) }, 3), { kind: "checking", progress: 1 });
  assert.deepEqual(
    placeStatus({ owned: partial("yes", 2), certified: none, pork: partial("no", 2), alcohol: none }, 2),
    { kind: "checking", progress: 2 },
  );
  assert.deepEqual(placeStatus({ owned: none, certified: none, pork: none, alcohol: none }, 0), { kind: "unchecked" });
});

const DAY = ACCOUNT_AGE_MS;
let clock = 10 * DAY;
function check(userId: string, answers: Partial<CheckForStatus> = {}): CheckForStatus {
  clock += 1000;
  return {
    userId,
    createdAt: clock,
    authorCreatedAt: 0,
    excluded: false,
    authorSuspended: false,
    owned: "yes",
    certified: "yes",
    pork: "no",
    alcohol: "no",
    ...answers,
  };
}

test("deriveStatus: three matching people verify a place", () => {
  assert.equal(deriveStatus([]).status.kind, "unchecked");
  const one = deriveStatus([check("a")]);
  assert.deepEqual(one.status, { kind: "checking", progress: 1 });
  const three = deriveStatus([check("a"), check("b"), check("c")]);
  assert.deepEqual(three.status, { kind: "verified" });
  assert.equal(three.eligibleChecks, 3);
  assert.deepEqual(three.authorsNewestFirst, ["c", "b", "a"]);
});

test("deriveStatus: three is the minimum, and more checks keep counting", () => {
  const five = deriveStatus(["a", "b", "c", "d", "e"].map((id) => check(id)));
  assert.deepEqual(five.status, { kind: "verified" });
  assert.equal(five.eligibleChecks, 5);
  assert.equal(five.facts.owned.streak, 5);
  assert.deepEqual(five.facts.owned.sources, ["community"]);
});

test("deriveStatus: one person checking three times counts once", () => {
  const result = deriveStatus([check("a"), check("a"), check("a")]);
  assert.deepEqual(result.status, { kind: "checking", progress: 1 });
  assert.equal(result.eligibleChecks, 1);
});

test("deriveStatus: only a person's latest check counts", () => {
  const result = deriveStatus([check("a", { alcohol: "yes" }), check("b"), check("c"), check("a")]);
  assert.equal(result.facts.alcohol.value, "no");
  assert.deepEqual(result.status, { kind: "verified" });
});

test("deriveStatus: newest answer wins and resets the streak", () => {
  const result = deriveStatus([check("a"), check("b"), check("c"), check("d", { alcohol: "yes" })]);
  assert.deepEqual(result.facts.alcohol, { ...partial("yes", 1), sources: ["community"], disputed: false });
  assert.deepEqual(result.status, { kind: "checking", progress: 1 });
});

test("deriveStatus: young accounts, excluded checks and suspended authors don't count", () => {
  const young = check("a");
  young.authorCreatedAt = young.createdAt - DAY + 1;
  const result = deriveStatus([
    young,
    { ...check("b"), excluded: true },
    { ...check("c"), authorSuspended: true },
  ]);
  assert.equal(result.eligibleChecks, 0);
  assert.equal(result.status.kind, "unchecked");
  const old = check("d");
  old.authorCreatedAt = old.createdAt - DAY;
  assert.equal(deriveStatus([old]).eligibleChecks, 1);
});

test("filters match on value; unknown never matches", () => {
  assert.deepEqual(parseFilters("owned,no-pork,bogus"), ["owned", "no-pork"]);
  const place = { status: "checking" as const, owned: "yes" as const, certified: null, pork: "no" as const, alcohol: null };
  assert.equal(matchesFilters(place, ["owned", "no-pork"]), true);
  assert.equal(matchesFilters(place, ["certified"]), false);
  assert.equal(matchesFilters(place, ["no-alcohol"]), false);
  assert.equal(matchesFilters(place, ["verified"]), false);
  assert.equal(matchesFilters({ ...place, status: "verified" }, ["verified"]), true);
});

test("labels and tones", () => {
  assert.equal(statusLabel({ kind: "verified" }), "✓ Verified");
  assert.equal(statusLabel({ kind: "checking", progress: 2 }), "2 of 3 checks");
  assert.equal(statusLabel({ kind: "unchecked" }), "Not checked yet");
  assert.equal(factAnswerLabel("pork", "no"), "Not served");
  assert.equal(factAnswerLabel("owned", null), "Not known yet");
  assert.equal(factTone("alcohol", "yes"), "bad");
  assert.equal(factTone("owned", "no"), "neutral");
  assert.equal(factTone("certified", "yes"), "good");
  assert.deepEqual(
    factTags({ owned: "no", certified: "yes", pork: null, alcohol: "yes" }).map((tag) => tag.text),
    ["Certified", "Serves alcohol", "Not Muslim-owned"],
  );
});

const NOW = 100 * DAY;
const signal = (source: Signal["source"], fact: Signal["fact"], value: "yes" | "no", extra: Partial<Signal> = {}): Signal => ({
  source,
  fact,
  value,
  at: NOW - DAY,
  ...extra,
});

test("resolveFact: an approved certificate settles certified on its own", () => {
  const state = resolveFact(factState([]), null, [signal("certificate", "certified", "yes")], "certified", NOW);
  assert.deepEqual(state, { value: "yes", streak: 0, settled: true, sources: ["certificate"], disputed: false });
});

test("resolveFact: an expired certificate stops counting", () => {
  const expired = signal("certificate", "certified", "yes", { expiresAt: NOW - 1 });
  assert.equal(resolveFact(factState([]), null, [expired], "certified", NOW).settled, false);
});

test("resolveFact: evidence only answers the facts it can speak to", () => {
  const stray = signal("certificate", "pork", "no");
  assert.equal(resolveFact(factState([]), null, [stray], "pork", NOW).value, null);
});

test("resolveFact: a menu and community checks agreeing list both sources", () => {
  const state = resolveFact(factState(["no", "no", "no", "no"]), NOW, [signal("menu", "alcohol", "no")], "alcohol", NOW);
  assert.equal(state.settled, true);
  assert.equal(state.streak, 4);
  assert.deepEqual(state.sources, ["community", "menu"]);
  assert.equal(factEvidence(state), "4 people · Menu");
});

test("resolveFact: settling sources that disagree leave the fact disputed", () => {
  const state = resolveFact(factState(["yes", "yes", "yes"]), NOW, [signal("menu", "alcohol", "no")], "alcohol", NOW);
  assert.equal(state.settled, false);
  assert.equal(state.disputed, true);
  assert.equal(state.value, "yes");
  assert.equal(factEvidence(state), "Sources disagree");
});

test("resolveFact: a listing fills in a value but never settles", () => {
  const listing = signal("listing", "pork", "no");
  const alone = resolveFact(factState([]), null, [listing], "pork", NOW);
  assert.deepEqual(alone, { value: "no", streak: 0, settled: false, sources: ["listing"], disputed: false });
  const outvoted = resolveFact(factState(["yes"]), NOW, [listing], "pork", NOW);
  assert.equal(outvoted.value, "yes");
  assert.deepEqual(outvoted.sources, ["community"]);
});

test("deriveStatus: documents and checks verify a place together", () => {
  const checks = [check("a", { certified: "unsure" }), check("b", { certified: "unsure" }), check("c", { certified: null })];
  assert.equal(deriveStatus(checks, [], NOW).status.kind, "checking");
  const result = deriveStatus(checks, [signal("certificate", "certified", "yes")], NOW);
  assert.deepEqual(result.status, { kind: "verified" });
  assert.deepEqual(result.facts.certified.sources, ["certificate"]);
});

test("deriveStatus: a listing alone leaves a place unchecked; a certificate does not", () => {
  assert.equal(deriveStatus([], [signal("listing", "pork", "no")], NOW).status.kind, "unchecked");
  assert.deepEqual(deriveStatus([], [signal("certificate", "certified", "yes")], NOW).status, {
    kind: "checking",
    progress: 1,
  });
});

test("listing claims and source lists", () => {
  assert.equal(parseListingClaim(" Only "), "only");
  assert.equal(parseListingClaim("limited"), "yes");
  assert.equal(parseListingClaim("no"), "no");
  assert.equal(parseListingClaim("maybe"), null);
  assert.deepEqual(listingFacts("only"), { pork: "no" });
  assert.deepEqual(listingFacts("yes"), {});
  assert.equal(formatSources(["community", "menu"]), "community,menu");
  assert.deepEqual(parseSources("menu,bogus,community"), ["community", "menu"]);
  assert.deepEqual(parseSources(null), []);
});
