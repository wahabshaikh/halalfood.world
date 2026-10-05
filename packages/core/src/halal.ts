/**
 * The halal model: four facts, settled by three matching answers.
 *
 * 1. A check answers up to four facts: Muslim-owned, Halal certified, Serves
 *    pork, Serves alcohol. Each answer is yes, no, unsure or blank.
 * 2. A fact is settled when the three newest definite answers (yes/no) from
 *    eligible checks agree. Unsure and blank answers are skipped.
 * 3. A place is Community verified when all four facts are settled.
 *
 * Only a person's latest check at a place counts, and only once their account
 * is a day old. Social signals (likes, follows, lists, points) never reach
 * this module.
 */

export const FACTS = ["owned", "certified", "pork", "alcohol"] as const;
export type Fact = (typeof FACTS)[number];

export const ANSWERS = ["yes", "no", "unsure"] as const;
export type Answer = (typeof ANSWERS)[number] | null;
export type Definite = "yes" | "no";

export const MATCHES_TO_SETTLE = 3;

/** An account must be this old when it checks a place for the check to count. */
export const ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

export type FactState = {
  value: Definite | null;
  streak: 0 | 1 | 2 | 3;
  settled: boolean;
};

export type Facts = Record<Fact, FactState>;

export type PlaceStatus =
  | { kind: "verified" }
  | { kind: "checking"; progress: 1 | 2 }
  | { kind: "unchecked" };

export type StatusKind = PlaceStatus["kind"];

/** Fold a fact's answers, newest first, into its value and streak. */
export function factState(answersNewestFirst: readonly Answer[]): FactState {
  let value: Definite | null = null;
  let streak = 0;
  for (const answer of answersNewestFirst) {
    if (answer !== "yes" && answer !== "no") continue;
    if (value === null) value = answer;
    if (answer !== value || streak === MATCHES_TO_SETTLE) break;
    streak++;
  }
  return {
    value,
    streak: streak as FactState["streak"],
    settled: streak === MATCHES_TO_SETTLE,
  };
}

export function placeStatus(facts: Facts, eligibleCheckCount: number): PlaceStatus {
  if (FACTS.every((fact) => facts[fact].settled)) return { kind: "verified" };
  if (eligibleCheckCount <= 0) return { kind: "unchecked" };
  const streaks = FACTS.map((fact) => facts[fact])
    .filter((state) => state.value !== null)
    .map((state) => state.streak);
  const lowest = streaks.length ? Math.min(...streaks) : 1;
  return { kind: "checking", progress: lowest >= 2 ? 2 : 1 };
}

export function statusProgress(status: PlaceStatus): 0 | 1 | 2 | 3 {
  return status.kind === "verified" ? 3 : status.kind === "checking" ? status.progress : 0;
}

/** The fields of a check the status derivation reads. */
export type CheckForStatus = {
  userId: string;
  createdAt: number;
  authorCreatedAt: number;
  excluded: boolean;
  authorSuspended: boolean;
} & Record<Fact, Answer>;

export function isEligible(check: CheckForStatus): boolean {
  return (
    !check.excluded &&
    !check.authorSuspended &&
    check.createdAt - check.authorCreatedAt >= ACCOUNT_AGE_MS
  );
}

export type DerivedStatus = {
  status: PlaceStatus;
  facts: Facts;
  eligibleChecks: number;
  lastCheckedAt: number | null;
  /** Authors of the eligible checks, newest first, one per person. */
  authorsNewestFirst: string[];
};

/**
 * Derive a place's status from all of its checks. Each person's latest
 * eligible check counts; earlier ones are visit history.
 */
export function deriveStatus(checks: readonly CheckForStatus[]): DerivedStatus {
  const latestByUser = new Map<string, CheckForStatus>();
  for (const check of checks) {
    if (!isEligible(check)) continue;
    const current = latestByUser.get(check.userId);
    if (!current || check.createdAt > current.createdAt) latestByUser.set(check.userId, check);
  }
  const counted = [...latestByUser.values()].sort((a, b) => b.createdAt - a.createdAt);
  const facts = Object.fromEntries(
    FACTS.map((fact) => [fact, factState(counted.map((check) => check[fact]))]),
  ) as Facts;
  return {
    status: placeStatus(facts, counted.length),
    facts,
    eligibleChecks: counted.length,
    lastCheckedAt: counted[0]?.createdAt ?? null,
    authorsNewestFirst: counted.map((check) => check.userId),
  };
}

/** The value of each fact that a diner wants. */
export const FAVOURABLE: Record<Fact, Definite> = {
  owned: "yes",
  certified: "yes",
  pork: "no",
  alcohol: "no",
};

export type FactTone = "good" | "bad" | "neutral" | "unknown";

/** Not Muslim-owned or not certified is neutral; serving pork or alcohol is bad. */
export function factTone(fact: Fact, value: Definite | null): FactTone {
  if (value === null) return "unknown";
  if (value === FAVOURABLE[fact]) return "good";
  return fact === "pork" || fact === "alcohol" ? "bad" : "neutral";
}

export const FACT_QUESTION: Record<Fact, string> = {
  owned: "Muslim-owned",
  certified: "Halal certified",
  pork: "Pork",
  alcohol: "Alcohol",
};

export function factAnswerLabel(fact: Fact, value: Definite | null): string {
  if (value === null) return "Not known yet";
  if (fact === "pork" || fact === "alcohol") return value === "yes" ? "Served" : "Not served";
  return value === "yes" ? "Yes" : "No";
}

/** Short tags for place rows. Unknown facts are left out. */
export function factTags(facts: Record<Fact, Definite | null>): { text: string; tone: FactTone }[] {
  const tags: { text: string; tone: FactTone }[] = [];
  if (facts.owned === "yes") tags.push({ text: "Muslim-owned", tone: "good" });
  if (facts.certified === "yes") tags.push({ text: "Certified", tone: "good" });
  if (facts.pork === "yes") tags.push({ text: "Serves pork", tone: "bad" });
  if (facts.alcohol === "yes") tags.push({ text: "Serves alcohol", tone: "bad" });
  if (facts.owned === "no") tags.push({ text: "Not Muslim-owned", tone: "neutral" });
  return tags;
}

export function statusLabel(status: PlaceStatus, short = false): string {
  if (status.kind === "verified") return short ? "✓ Verified" : "✓ Community verified";
  if (status.kind === "checking")
    return short ? `${status.progress} of 3` : `${status.progress} of 3 checks`;
  return short ? "Not checked" : "Not checked yet";
}

export function parseStatus(kind: unknown, progress: unknown): PlaceStatus {
  if (kind === "verified") return { kind: "verified" };
  if (kind === "checking") return { kind: "checking", progress: Number(progress) >= 2 ? 2 : 1 };
  return { kind: "unchecked" };
}

export function parseDefinite(value: unknown): Definite | null {
  return value === "yes" || value === "no" ? value : null;
}

/* ------------------------------------------------------------------------ */
/* Filters                                                                   */
/* ------------------------------------------------------------------------ */

export const FILTERS = ["verified", "owned", "certified", "no-pork", "no-alcohol"] as const;
export type Filter = (typeof FILTERS)[number];

export const FILTER_LABEL: Record<Filter, string> = {
  verified: "Verified",
  owned: "Muslim-owned",
  certified: "Halal certified",
  "no-pork": "No pork",
  "no-alcohol": "No alcohol",
};

/** Parse `filters=owned,no-pork` leniently; unknown names are ignored. */
export function parseFilters(value: string | null | undefined): Filter[] {
  if (!value) return [];
  const wanted = new Set(value.split(",").map((part) => part.trim()));
  return FILTERS.filter((filter) => wanted.has(filter));
}

export type FilterablePlace = { status: StatusKind } & Record<Fact, Definite | null>;

/** Filters match on a fact's current value, settled or not. Unknown never matches. */
export function matchesFilters(place: FilterablePlace, filters: readonly Filter[]): boolean {
  return filters.every((filter) => {
    switch (filter) {
      case "verified":
        return place.status === "verified";
      case "owned":
        return place.owned === "yes";
      case "certified":
        return place.certified === "yes";
      case "no-pork":
        return place.pork === "no";
      case "no-alcohol":
        return place.alcohol === "no";
    }
  });
}
