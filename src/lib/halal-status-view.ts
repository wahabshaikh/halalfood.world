/**
 * Client-safe public halal status contract and copy formatter.
 *
 * Keep this module free of database/runtime imports so it can be shared by
 * the server-rendered hero and the client evidence section.
 */
export type HalalStatus =
  | {
      status: "unverified";
      approvedCount: 0;
      latestReviewedAt: null;
    }
  | {
      status: "evidence-backed";
      approvedCount: number;
      latestReviewedAt: string;
    }
  | { status: "unavailable" };

export type HalalStatusViewModel = {
  status: HalalStatus["status"];
  label: string;
  detail: string;
  explanation: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse the public summary shape returned by the verification API. */
export function parseHalalStatus(value: unknown): HalalStatus {
  const item = record(value);
  if (!item || typeof item.status !== "string") return { status: "unavailable" };

  if (item.status === "unavailable") return { status: "unavailable" };

  if (
    item.status === "unverified" &&
    item.approvedCount === 0 &&
    item.latestReviewedAt === null
  )
    return {
      status: "unverified",
      approvedCount: 0,
      latestReviewedAt: null,
    };

  if (
    item.status === "evidence-backed" &&
    typeof item.approvedCount === "number" &&
    Number.isSafeInteger(item.approvedCount) &&
    item.approvedCount > 0 &&
    typeof item.latestReviewedAt === "string" &&
    Number.isFinite(new Date(item.latestReviewedAt).getTime())
  )
    return {
      status: "evidence-backed",
      approvedCount: item.approvedCount,
      latestReviewedAt: item.latestReviewedAt.trim(),
    };

  return { status: "unavailable" };
}

function reviewedDate(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

/** Convert a public status into shared, truthful UI copy. */
export function formatHalalStatus(status: HalalStatus): HalalStatusViewModel {
  if (status.status === "evidence-backed") {
    const checkNoun = status.approvedCount === 1 ? "check" : "checks";
    const latestReviewed = reviewedDate(status.latestReviewedAt);
    if (!latestReviewed)
      return {
        status: "unavailable",
        label: "Checks unavailable right now",
        detail: "We couldn’t load the halal checks. Please try again shortly.",
        explanation: "Please try again later.",
      };
    return {
      status: status.status,
      label: "Checked by the community",
      detail:
        `${status.approvedCount} approved ${checkNoun}. ` +
        `Latest approved ${latestReviewed}.`,
      explanation:
        "People shared what they saw and a moderator reviewed it. We don’t certify places ourselves.",
    };
  }

  if (status.status === "unverified")
    return {
      status: status.status,
      label: "Not checked yet",
      detail: "Nobody has shared a halal check for this place yet.",
      explanation: "Not checked doesn’t mean not halal.",
    };

  return {
    status: status.status,
    label: "Checks unavailable right now",
    detail: "We couldn’t load the halal checks. Please try again shortly.",
    explanation: "Please try again later.",
  };
}
