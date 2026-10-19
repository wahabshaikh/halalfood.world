/**
 * Listing provenance: where a place came from, and whether an imported one has
 * been seen and verified to exist (docs/spec/halal-model.md#provenance).
 *
 * This is not a halal status. Any counted check also verifies that a place
 * exists, but so do things that never touch halal status (AGENTS.md rule 4):
 * a creator video or a sourced certified claim can lift the label from a place
 * that stays "Not checked yet".
 *
 * Only imported places are ever labelled. Places people add, and places Halal
 * Food Scout lists, have no import source and never carry the label.
 */

/** Import sources, stored in `places.import_source`. Stable strings: add, never repurpose. */
export const IMPORT_SOURCES = ["halalfoodnear.me"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/**
 * The halalfoodnear.me scrape (13 Sep 2026) reached production at the Oct 5
 * cutover with one bulk-insert timestamp and no submitter, and without its
 * scrape columns. Places created since use their own `Date.now()`, so this
 * exact millisecond identifies the import. Migration 0007 backfills with it.
 */
export const HALALFOODNEARME_IMPORT = {
  source: "halalfoodnear.me",
  /** 2026-09-13T06:58:19.475Z. */
  createdAt: 1789282699475,
} as const satisfies { source: ImportSource; createdAt: number };

/** True for a row from the halalfoodnear.me bulk import (migration 0007's predicate). */
export function isHalalfoodnearmeImport(row: { createdAt: number; submittedByUserId: string | null }): boolean {
  return row.createdAt === HALALFOODNEARME_IMPORT.createdAt && row.submittedByUserId === null;
}

/**
 * What says an imported place exists. Map listings never count: they come
 * from directories too. Social signals besides creator videos never count.
 */
export type ExistenceEvidence = {
  /** Checks that count toward halal status (`isEligible` in lib/core/halal.ts). */
  eligibleChecks: number;
  /** Approved certificate or menu photos (`place_signals`), expired or not. */
  approvedDocuments: number;
  /** Halal Food Scout creator video verifications (`creator_verifications`). */
  creatorVerifications: number;
  /** Scout web claims of certified = yes with a source URL (`place_claims`). */
  sourcedCertifiedClaims: number;
};

/** An imported place counts as verified when any one kind of evidence exists. */
export function seenToExist(evidence: ExistenceEvidence): boolean {
  return (
    evidence.eligibleChecks > 0 ||
    evidence.approvedDocuments > 0 ||
    evidence.creatorVerifications > 0 ||
    evidence.sourcedCertifiedClaims > 0
  );
}

/**
 * The next `places.import_verified_at`. It is recomputed from the evidence on
 * every write, so removing the last piece (a verification removed, a check
 * excluded) makes the place unverified again. While evidence stays, the first
 * time it was verified is kept.
 */
export function nextImportVerifiedAt(current: number | null, seen: boolean, now: number): number | null {
  if (!seen) return null;
  return current ?? now;
}

/** The label and noindex rule. Mirrors the SQL in lib/place-view.ts (`UNVERIFIED_SQL`). */
export function isUnverifiedImport(place: { importSource: string | null; importVerifiedAt: number | null }): boolean {
  return place.importSource !== null && place.importVerifiedAt === null;
}

export const UNVERIFIED_LABEL = "Unverified";
export const UNVERIFIED_EXPLAINER = "Imported from a public directory and not yet checked by our community or a certifier.";
