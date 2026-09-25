/**
 * Client-safe copy for the "Halal at a glance" list on a place page. Kept free
 * of database imports so both server and client components can use it.
 */
export type GlanceQuestion = "certificate" | "alcohol" | "meat";

export type GlanceEntry = { value: string; reviewedAt: string } | null;

export type GlanceLine = {
  question: GlanceQuestion;
  label: string;
  detail: string;
  known: boolean;
};

const COPY: Record<GlanceQuestion, { unknown: string; values: Record<string, string> }> = {
  certificate: {
    unknown: "Certificate not checked yet",
    values: {
      seen: "Halal certificate on display",
      "not-seen": "No certificate on display",
    },
  },
  alcohol: {
    unknown: "Alcohol not checked yet",
    values: {
      none: "No alcohol served",
      served: "Alcohol is served",
    },
  },
  meat: {
    unknown: "Slaughter method not checked yet",
    values: {
      hand: "Hand-slaughtered meat",
      machine: "Machine-slaughtered meat",
    },
  },
};

export function formatCheckDate(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function glanceLines(glance: Record<GlanceQuestion, GlanceEntry>): GlanceLine[] {
  return (Object.keys(COPY) as GlanceQuestion[]).map((question) => {
    const entry = glance[question];
    const label = entry ? COPY[question].values[entry.value] : undefined;
    const date = entry ? formatCheckDate(entry.reviewedAt) : null;
    if (!entry || !label || !date)
      return {
        question,
        label: COPY[question].unknown,
        detail: "Be the first to check",
        known: false,
      };
    return { question, label, detail: "Checked " + date, known: true };
  });
}

/** Label for a single structured answer shown on a check entry. */
export function answerLabel(question: GlanceQuestion, value: string | null): string | null {
  if (!value || value === "unsure") return null;
  return COPY[question].values[value] ?? null;
}

/** Approved checks a place needs before it can be called a community favourite. */
export const COMMUNITY_FAVOURITE_MIN_CHECKS = 3;
export const COMMUNITY_FAVOURITE_MIN_RATING = 4.5;

/**
 * "Community favourite" is only shown when people have both checked the place
 * and rated it highly, so the badge never rests on a rating alone.
 */
export function isCommunityFavourite(
  approvedChecks: number,
  googleRating: string | number | null | undefined,
): boolean {
  const rating = Number(googleRating);
  return (
    Number.isFinite(approvedChecks) &&
    approvedChecks >= COMMUNITY_FAVOURITE_MIN_CHECKS &&
    Number.isFinite(rating) &&
    rating >= COMMUNITY_FAVOURITE_MIN_RATING
  );
}
