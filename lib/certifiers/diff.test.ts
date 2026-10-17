import { test } from "vitest";
import assert from "node:assert/strict";
import type { SourceRow } from "./bpjph";
import { autoPublishes, diffRecognitions, removalsAllowed, reviewStateFor, type CurrentRecognition } from "./diff";

function rec(id: string, overrides: Partial<CurrentRecognition> = {}): CurrentRecognition {
  return {
    recognitionId: `r-${id}`,
    certifierId: `c-${id}`,
    name: `Body ${id}`,
    sourceKey: `K-${id}`,
    status: "recognised",
    scopes: ["food"],
    scopesRaw: "Food",
    validUntil: "2028-01-01",
    ...overrides,
  };
}

function row(id: string, overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    sourceKey: `K-${id}`,
    name: `Body ${id}`,
    countryRaw: "Australia",
    countryCode: "AU",
    city: null,
    address: null,
    scopesRaw: "Food",
    scopes: ["food"],
    sourceRef: null,
    validUntil: "2028-01-01",
    sourceStatus: "MRA",
    ...overrides,
  };
}

const aliases = (current: CurrentRecognition[]) => new Map(current.map((each) => [each.name.toLowerCase(), each.certifierId]));

test("an unchanged list has no changes and every row is seen", () => {
  const current = [rec("a"), rec("b")];
  const diff = diffRecognitions(current, [row("a"), row("b")], aliases(current));
  assert.deepEqual(diff.changes, []);
  assert.deepEqual(diff.seen.map((each) => each.recognitionId), ["r-a", "r-b"]);
});

test("each kind of change is detected", () => {
  const current = [rec("a"), rec("b"), rec("c"), rec("d"), rec("gone")];
  const incoming = [
    row("a", { validUntil: "2030-06-30" }),
    row("b", { scopes: ["food", "cosmetics"], scopesRaw: "Food|Cosmetics" }),
    row("c", { scopes: [], scopesRaw: "" }),
    row("d", { name: "Totally Different Council" }),
    row("new", { name: "Brand New Body" }),
  ];
  const diff = diffRecognitions(current, incoming, aliases(current));
  const kinds = diff.changes.map((change) => `${change.kind}:${change.recognitionId ?? change.row?.name}`);
  assert.deepEqual(kinds.sort(), [
    "added:Brand New Body",
    "date_changed:r-a",
    "removed:r-gone",
    "renamed:r-d",
    "scope_added:r-b",
    "scope_removed:r-c",
  ]);
  const added = diff.changes.find((change) => change.kind === "added")!;
  assert.equal(added.certifierId, null, "a body we have never seen has no certifier yet");
  const scope = diff.changes.find((change) => change.kind === "scope_added")!;
  assert.deepEqual(scope.after?.added, ["cosmetics"]);
});

test("rows match by the source's id first, so a renamed body is a rename and not a removal plus an addition", () => {
  const current = [rec("a", { name: "Old Name Council" })];
  const diff = diffRecognitions(current, [row("a", { name: "New Name Council" })], new Map());
  assert.deepEqual(diff.changes.map((change) => change.kind), ["renamed"]);
  assert.deepEqual(diff.changes[0].before, { name: "Old Name Council" });
});

test("without the source's id, rows match by normalised name", () => {
  const current = [rec("a", { sourceKey: null, name: "Halal Body" })];
  const diff = diffRecognitions(current, [row("x", { name: "HALAL BODY Pty Ltd" })], new Map([["halal body", "c-a"]]));
  assert.deepEqual(diff.changes, []);
  assert.equal(diff.seen[0].recognitionId, "r-a");
});

test("a known body that the authority lists again is added back on its old recognition", () => {
  const current = [rec("a", { status: "removed" })];
  const diff = diffRecognitions(current, [row("a")], aliases(current));
  assert.equal(diff.changes[0].kind, "added");
  assert.equal(diff.changes[0].recognitionId, "r-a");
  assert.equal(diff.changes[0].certifierId, "c-a");
});

test("a scope added and another removed in one go make two events with both lists", () => {
  const current = [rec("a", { scopes: ["food", "beverages"] })];
  const diff = diffRecognitions(current, [row("a", { scopes: ["food", "cosmetics"] })], aliases(current));
  assert.deepEqual(diff.changes.map((change) => change.kind), ["scope_added", "scope_removed"]);
  assert.deepEqual(diff.changes[1].after?.removed, ["beverages"]);
  assert.deepEqual(diff.changes[1].after?.added, ["cosmetics"]);
});

test("safety rule: more than a 10% drop holds back every removal", () => {
  assert.equal(removalsAllowed(124, 112), true);
  assert.equal(removalsAllowed(124, 111), false);
  assert.equal(removalsAllowed(0, 0), true);
  const current = Array.from({ length: 10 }, (_, index) => rec(String(index)));
  const incoming = current.slice(0, 8).map((each) => row(each.recognitionId.slice(2)));
  const diff = diffRecognitions(current, incoming, aliases(current), { allowRemovals: removalsAllowed(10, 8) });
  assert.equal(diff.changes.filter((change) => change.kind === "removed").length, 0);
  assert.equal(diff.suppressedRemovals, 2);
  const allowed = diffRecognitions(current, incoming, aliases(current));
  assert.equal(allowed.changes.filter((change) => change.kind === "removed").length, 2);
});

test("auto-publish: later dates and added scopes only", () => {
  assert.equal(autoPublishes({ kind: "scope_added", before: null, after: null }), true);
  assert.equal(autoPublishes({ kind: "date_changed", before: { validUntil: "2028-01-01" }, after: { validUntil: "2030-01-01" } }), true);
  assert.equal(autoPublishes({ kind: "date_changed", before: { validUntil: "2030-01-01" }, after: { validUntil: "2028-01-01" } }), false);
  assert.equal(autoPublishes({ kind: "date_changed", before: { validUntil: null }, after: { validUntil: "2028-01-01" } }), false);
  assert.equal(autoPublishes({ kind: "date_changed", before: { validUntil: "2028-01-01" }, after: { validUntil: null } }), false);
  for (const kind of ["added", "removed", "renamed", "scope_removed"] as const) assert.equal(reviewStateFor({ kind, before: null, after: null }), "pending");
  assert.equal(reviewStateFor({ kind: "scope_added", before: null, after: null }), "published");
});
