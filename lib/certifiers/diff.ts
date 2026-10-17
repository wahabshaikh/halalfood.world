/**
 * Comparing a fresh parse of an official list with the recognitions we hold, and deciding which
 * changes publish on their own (docs/spec/certifiers.md).
 *
 * - Rows match by the source's own id first (`source_key`), then by normalised name.
 * - Change kinds are stable strings: added, removed, scope_added, scope_removed, date_changed, renamed.
 *   ("expired" is never stored: it is computed from `valid_until` when a page renders.)
 * - Safety: if the list shrank by more than 10%, no removals are written and the source needs a look.
 * - Policy: a later expiry date or an added scope publishes at once; everything else waits for review.
 */
import type { SourceRow } from "./bpjph";
import { isRename, matchCertifier, type AliasIndex } from "./names";
import { SCOPE_CODES, type ScopeCode } from "./scopes";

export const CHANGE_KINDS = ["added", "removed", "scope_added", "scope_removed", "date_changed", "renamed", "expired", "status_changed"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const RECOGNITION_STATUSES = ["recognised", "expired", "suspended", "removed", "pending"] as const;
export type RecognitionStatus = (typeof RECOGNITION_STATUSES)[number];

export type ReviewState = "pending" | "published" | "rejected";

/** A recognition as the diff needs it. */
export type CurrentRecognition = {
  recognitionId: string;
  certifierId: string;
  name: string;
  sourceKey: string | null;
  status: RecognitionStatus;
  scopes: ScopeCode[];
  scopesRaw: string | null;
  validUntil: string | null;
};

export type DetectedChange = {
  kind: ChangeKind;
  /** Null for a body this authority has never listed. */
  recognitionId: string | null;
  /** Null for a body we have never seen: the runner creates it before writing the change. */
  certifierId: string | null;
  row: SourceRow | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type Diff = {
  changes: DetectedChange[];
  /** Rows that are still listed, with the recognition they belong to (for last_seen and details). */
  seen: { recognitionId: string; row: SourceRow }[];
  /** Removals held back by the safety rule. */
  suppressedRemovals: number;
};

/** More than this share of rows gone at once looks like a broken page, not a policy change. */
export const MAX_ROW_DROP = 0.1;

/** False when the new list is too much shorter than what we hold to trust its removals. */
export function removalsAllowed(previousCount: number, incomingCount: number): boolean {
  if (previousCount <= 0) return true;
  return incomingCount >= previousCount * (1 - MAX_ROW_DROP);
}

function ordered(codes: Iterable<ScopeCode>): ScopeCode[] {
  const set = new Set(codes);
  return SCOPE_CODES.filter((code) => set.has(code));
}

export function diffRecognitions(
  current: readonly CurrentRecognition[],
  incoming: readonly SourceRow[],
  aliases: AliasIndex,
  options: { allowRemovals: boolean } = { allowRemovals: true },
): Diff {
  const byKey = new Map(current.filter((rec) => rec.sourceKey).map((rec) => [rec.sourceKey as string, rec]));
  const byCertifier = new Map(current.map((rec) => [rec.certifierId, rec]));
  const claimed = new Set<string>();
  const changes: DetectedChange[] = [];
  const seen: Diff["seen"] = [];

  for (const row of incoming) {
    const aliasMatch = matchCertifier(row.name, aliases);
    let rec = byKey.get(row.sourceKey);
    if (!rec || claimed.has(rec.recognitionId)) {
      const byName = aliasMatch ? byCertifier.get(aliasMatch) : undefined;
      rec = byName && !claimed.has(byName.recognitionId) ? byName : undefined;
    }
    if (!rec) {
      changes.push({ kind: "added", recognitionId: null, certifierId: aliasMatch, row, before: null, after: { ...row } });
      continue;
    }
    claimed.add(rec.recognitionId);
    if (rec.status === "removed") {
      changes.push({ kind: "added", recognitionId: rec.recognitionId, certifierId: rec.certifierId, row, before: { status: "removed" }, after: { ...row } });
      continue;
    }
    seen.push({ recognitionId: rec.recognitionId, row });
    const base = { recognitionId: rec.recognitionId, certifierId: rec.certifierId, row };

    if (isRename(rec.name, row.name)) changes.push({ ...base, kind: "renamed", before: { name: rec.name }, after: { name: row.name } });

    const before = new Set(rec.scopes);
    const after = new Set(row.scopes);
    const added = ordered(row.scopes.filter((code) => !before.has(code)));
    const removed = ordered(rec.scopes.filter((code) => !after.has(code)));
    if (added.length)
      changes.push({
        ...base,
        kind: "scope_added",
        before: { scopes: rec.scopes, scopesRaw: rec.scopesRaw },
        after: { scopes: row.scopes, scopesRaw: row.scopesRaw, added, removed },
      });
    if (removed.length)
      changes.push({
        ...base,
        kind: "scope_removed",
        before: { scopes: rec.scopes, scopesRaw: rec.scopesRaw },
        after: { scopes: row.scopes, scopesRaw: row.scopesRaw, added, removed },
      });

    if (rec.validUntil !== row.validUntil)
      changes.push({ ...base, kind: "date_changed", before: { validUntil: rec.validUntil }, after: { validUntil: row.validUntil } });
  }

  let suppressedRemovals = 0;
  for (const rec of current) {
    if (rec.status === "removed" || claimed.has(rec.recognitionId)) continue;
    if (!options.allowRemovals) {
      suppressedRemovals += 1;
      continue;
    }
    changes.push({
      kind: "removed",
      recognitionId: rec.recognitionId,
      certifierId: rec.certifierId,
      row: null,
      before: { name: rec.name, status: rec.status, scopes: rec.scopes, validUntil: rec.validUntil },
      after: { status: "removed" },
    });
  }
  return { changes, seen, suppressedRemovals };
}

/**
 * Which changes publish without a person: an expiry moved later, or a scope added. Removals, new bodies,
 * renames, removed scopes and earlier or cleared dates wait in the review queue.
 */
export function autoPublishes(change: Pick<DetectedChange, "kind" | "before" | "after">): boolean {
  if (change.kind === "scope_added") return true;
  if (change.kind === "date_changed") {
    const before = change.before?.validUntil;
    const after = change.after?.validUntil;
    return typeof before === "string" && typeof after === "string" && after > before;
  }
  return false;
}

export function reviewStateFor(change: Pick<DetectedChange, "kind" | "before" | "after">): ReviewState {
  return autoPublishes(change) ? "published" : "pending";
}
