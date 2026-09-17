import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditValue,
  canAppeal,
  prioritizeQueue,
  requiresAudit,
  validateAppeal,
  validateReport,
  type QueueItem,
} from "../src/lib/moderation";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const DAY = 86_400_000;

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: overrides.id ?? "queue-1",
    placeId: "place-1",
    kind: "first-hand",
    claimedStatus: "self-declared",
    relationship: "none",
    incentivized: false,
    createdAt: NOW - DAY,
    expiresAt: null,
    conflicting: false,
    savedCount: 0,
    openReports: 0,
    ...overrides,
  };
}

test("a report needs a known target and reason", () => {
  assert.equal(validateReport({ targetType: "spaceship", targetId: "x", reason: "fraud" }).ok, false);
  assert.equal(validateReport({ targetType: "place", targetId: "x", reason: "vibes" }).ok, false);
  assert.equal(
    validateReport({ targetType: "place", targetId: "x", reason: "fraud" }).ok,
    true,
  );
});

test("harassment and other reports must say what happened", () => {
  assert.equal(
    validateReport({ targetType: "user", targetId: "x", reason: "harassment" }).ok,
    false,
  );
  assert.equal(
    validateReport({
      targetType: "user",
      targetId: "x",
      reason: "harassment",
      detail: "Repeated abusive messages on a list.",
    }).ok,
    true,
  );
});

test("an appeal needs a written reason", () => {
  assert.equal(validateAppeal({}).ok, false);
  assert.equal(validateAppeal({ reason: "  " }).ok, false);
  assert.equal(validateAppeal({ reason: "The certificate was current." }).ok, true);
});

test("only a decided report can be appealed", () => {
  assert.equal(canAppeal("open"), false);
  assert.equal(canAppeal("upheld"), true);
  assert.equal(canAppeal("dismissed"), true);
  assert.equal(canAppeal("appeal-upheld"), false);
});

test("conflicts outrank every other queue signal", () => {
  const queue = prioritizeQueue(
    [
      item({ id: "routine" }),
      item({ id: "conflict", conflicting: true }),
      item({ id: "reported", openReports: 3 }),
    ],
    NOW,
  );
  assert.equal(queue[0].id, "conflict");
  assert.ok(queue[0].rationale.includes("Conflicts with current evidence"));
});

test("expired and expiring evidence is prioritised, with its reason stated", () => {
  const queue = prioritizeQueue(
    [
      item({ id: "fresh", expiresAt: NOW + 300 * DAY }),
      item({ id: "expiring", expiresAt: NOW + 10 * DAY }),
      item({ id: "expired", expiresAt: NOW - DAY }),
    ],
    NOW,
  );
  assert.deepEqual(
    queue.map((entry) => entry.id),
    ["expired", "expiring", "fresh"],
  );
  assert.ok(queue[1].rationale.some((line) => /expires in 10 days/.test(line)));
});

test("high-impact claims and declared interests raise priority", () => {
  const queue = prioritizeQueue(
    [
      item({ id: "plain" }),
      item({ id: "verified-claim", claimedStatus: "verified" }),
      item({ id: "owner", relationship: "owner" }),
    ],
    NOW,
  );
  assert.equal(queue[0].id, "owner");
  assert.equal(queue[1].id, "verified-claim");
  assert.equal(queue[2].id, "plain");
});

test("every queue entry explains its own position", () => {
  const [entry] = prioritizeQueue([item()], NOW);
  assert.ok(entry.rationale.length > 0);
});

test("halal- and ranking-sensitive actions are always audited", () => {
  assert.equal(requiresAudit("status.changed"), true);
  assert.equal(requiresAudit("evidence.approved"), true);
  assert.equal(requiresAudit("duplicate.merged"), true);
  assert.equal(requiresAudit("evidence.submitted"), false);
});

test("audit payloads are bounded and never throw on odd input", () => {
  assert.equal(auditValue(undefined), null);
  assert.equal(auditValue({ a: 1 }), '{"a":1}');
  assert.equal(auditValue("x".repeat(9000))?.length, 4000);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(auditValue(cyclic), null);
});
