import {
  formatEvidenceAge,
  STATUS_COPY,
  type HalalTaxonomyStatus,
} from "./halal-taxonomy";

export type CardEvidence = {
  status: HalalTaxonomyStatus;
  label: string;
  /** Status plus a date, or an explicit statement that no dated evidence exists. */
  line: string;
  /** Where the status comes from. Never a Google rating. */
  source: "Community evidence";
};

/**
 * One line for a place card. Indexing a place does not create a status:
 * callers pass a status only after evidence has been read. Unverified is the
 * honest result of missing, stale, or conflicting evidence.
 */
export function cardEvidenceLine(
  input: {
    status: HalalTaxonomyStatus;
    latestEvidenceAt?: number | null;
    now?: number;
  },
): CardEvidence {
  const label = STATUS_COPY[input.status].label;
  const captured = input.latestEvidenceAt;
  const dated =
    input.status !== "unverified" &&
    typeof captured === "number" &&
    Number.isFinite(captured);
  if (!dated) {
    return {
      status: input.status,
      label,
      line:
        input.status === "unverified"
          ? "Unverified · no dated evidence"
          : `${label} · no dated evidence`,
      source: "Community evidence",
    };
  }
  return {
    status: input.status,
    label,
    line: `${label} · evidence ${formatEvidenceAge(captured, input.now ?? Date.now())}`,
    source: "Community evidence",
  };
}
