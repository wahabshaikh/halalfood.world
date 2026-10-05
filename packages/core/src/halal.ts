/**
 * The halal model: four facts, each settled by evidence from several sources.
 *
 * 1. A fact is one of four questions: Muslim-owned, Halal certified, Serves
 *    pork, Serves alcohol.
 * 2. Evidence comes from four sources (docs/product/halal-model.md):
 *    - community checks: a fact settles when at least three of the newest
 *      definite answers agree, and the count keeps growing past three;
 *    - a halal certificate, reviewed by a moderator and not expired, settles
 *      "Halal certified";
 *    - a menu, reviewed by a moderator, settles "Serves pork" and "Serves
 *      alcohol" for the answers it shows;
 *    - map listings (OpenStreetMap through Overpass, Geoapify) supply a value
 *      when nothing else does, but never settle a fact on their own.
 * 3. When settling sources disagree the fact is disputed, not settled.
 * 4. A place is Verified when all four facts are settled.
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

/** The fewest matching community answers that settle a fact. More keep counting. */
export const MATCHES_TO_SETTLE = 3;

export const SOURCES = ["community", "certificate", "menu", "listing"] as const;
export type Source = (typeof SOURCES)[number];

/** Sources a moderator reviews before they count. Each settles the facts it answers. */
export const DOCUMENT_SOURCES = ["certificate", "menu"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

/** The facts each kind of evidence may answer. */
export const SOURCE_FACTS: Record<Exclude<Source, "community">, readonly Fact[]> = {
  certificate: ["certified"],
  menu: ["pork", "alcohol"],
  listing: ["pork"],
};

/** What a map listing says about halal food, from OpenStreetMap's `diet:halal`. */
export const LISTING_CLAIMS = ["only", "yes", "no"] as const;
export type ListingClaim = (typeof LISTING_CLAIMS)[number];

/** An account must be this old when it checks a place for the check to count. */
export const ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

export type FactState = {
  value: Definite | null;
  /** Newest community answers in a row that agree with `value`. Not capped. */
  streak: number;
  settled: boolean;
  /** Sources whose answer matches `value`, strongest first. Set by `resolveFact`. */
  sources?: Source[];
  /** Two settling sources disagree, so the fact is not settled. */
  disputed?: boolean;
};

export type Facts = Record<Fact, FactState>;

export type PlaceStatus =
  | { kind: "verified" }
  | { kind: "checking"; progress: 1 | 2 }
  | { kind: "unchecked" };

export type StatusKind = PlaceStatus["kind"];

/** Fold a fact's community answers, newest first, into its value and streak. */
export function factState(answersNewestFirst: readonly Answer[]): FactState {
  let value: Definite | null = null;
  let streak = 0;
  for (const answer of answersNewestFirst) {
    if (answer !== "yes" && answer !== "no") continue;
    if (value === null) value = answer;
    if (answer !== value) break;
    streak++;
  }
  return { value, streak, settled: streak >= MATCHES_TO_SETTLE };
}

/** Evidence other than community checks: an approved document or a map listing. */
export type Signal = {
  source: Exclude<Source, "community">;
  fact: Fact;
  value: Definite;
  /** When it was approved (documents) or fetched (listings). */
  at: number;
  /** Certificates lapse; an expired one stops counting. */
  expiresAt?: number | null;
};

/** The newest live signal per source for one fact. */
function latestSignals(signals: readonly Signal[], fact: Fact, now: number): Signal[] {
  const latest = new Map<Signal["source"], Signal>();
  for (const signal of signals) {
    if (signal.fact !== fact || !SOURCE_FACTS[signal.source].includes(fact)) continue;
    if (signal.expiresAt != null && signal.expiresAt <= now) continue;
    const current = latest.get(signal.source);
    if (!current || signal.at > current.at) latest.set(signal.source, signal);
  }
  return [...latest.values()];
}

/**
 * Combine a fact's community answers with its other signals.
 *
 * Settling sources are three or more agreeing checks and moderator-reviewed
 * documents. If they all agree the fact is settled; if they disagree it is
 * disputed and takes the newest settling answer. With nothing settling, the
 * community value wins over a listing.
 */
export function resolveFact(
  community: FactState,
  communityAt: number | null,
  signals: readonly Signal[],
  fact: Fact,
  now: number,
): FactState {
  const live = latestSignals(signals, fact, now);
  const settling: { source: Source; value: Definite; at: number }[] = live
    .filter((signal) => (DOCUMENT_SOURCES as readonly string[]).includes(signal.source))
    .map(({ source, value, at }) => ({ source, value, at }));
  if (community.settled && community.value)
    settling.push({ source: "community", value: community.value, at: communityAt ?? 0 });

  let value: Definite | null;
  let settled = false;
  let disputed = false;
  if (settling.length) {
    const values = new Set(settling.map((entry) => entry.value));
    disputed = values.size > 1;
    settled = !disputed;
    value = [...settling].sort((a, b) => b.at - a.at)[0].value;
  } else {
    value = community.value ?? live.find((signal) => signal.source === "listing")?.value ?? null;
  }

  const sources = SOURCES.filter((source) => {
    if (value === null) return false;
    if (source === "community") return community.value === value;
    return live.some((signal) => signal.source === source && signal.value === value);
  });
  return { value, streak: community.value === value ? community.streak : 0, settled, sources, disputed };
}

export function placeStatus(facts: Facts, eligibleCheckCount: number): PlaceStatus {
  if (FACTS.every((fact) => facts[fact].settled)) return { kind: "verified" };
  // A listing alone never moves a place off "Not checked yet"; checks and
  // reviewed documents do.
  const reviewed = FACTS.some((fact) => facts[fact].settled);
  if (eligibleCheckCount <= 0 && !reviewed) return { kind: "unchecked" };
  // A fact settled by a document counts as fully checked here.
  const streaks = FACTS.map((fact) => facts[fact])
    .filter((state) => state.value !== null)
    .map((state) => (state.settled ? MATCHES_TO_SETTLE : state.streak));
  // Progress never runs ahead of the number of people who checked.
  const lowest = Math.min(streaks.length ? Math.min(...streaks) : 1, eligibleCheckCount);
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
  /** People whose latest check counts. Not capped at three. */
  eligibleChecks: number;
  lastCheckedAt: number | null;
  /** Authors of the eligible checks, newest first, one per person. */
  authorsNewestFirst: string[];
};

/**
 * Derive a place's status from its checks and other signals. Each person's
 * latest eligible check counts; earlier ones are visit history.
 */
export function deriveStatus(
  checks: readonly CheckForStatus[],
  signals: readonly Signal[] = [],
  now = Date.now(),
): DerivedStatus {
  const latestByUser = new Map<string, CheckForStatus>();
  for (const check of checks) {
    if (!isEligible(check)) continue;
    const current = latestByUser.get(check.userId);
    if (!current || check.createdAt > current.createdAt) latestByUser.set(check.userId, check);
  }
  const counted = [...latestByUser.values()].sort((a, b) => b.createdAt - a.createdAt);
  const facts = Object.fromEntries(
    FACTS.map((fact) => {
      const community = factState(counted.map((check) => check[fact]));
      const newestAnswer = counted.find((check) => check[fact] === "yes" || check[fact] === "no");
      return [fact, resolveFact(community, newestAnswer?.createdAt ?? null, signals, fact, now)];
    }),
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
  if (status.kind === "verified") return "✓ Verified";
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

/* ------------------------------------------------------------------------ */
/* Sources                                                                   */
/* ------------------------------------------------------------------------ */

export const SOURCE_LABEL: Record<Source, string> = {
  community: "Community checks",
  certificate: "Halal certificate",
  menu: "Menu",
  listing: "Map listing",
};

/** Store a fact's sources as a comma list, and read them back leniently. */
export function formatSources(sources: readonly Source[] | undefined): string {
  return (sources ?? []).join(",");
}

export function parseSources(value: unknown): Source[] {
  if (typeof value !== "string" || !value) return [];
  const wanted = new Set(value.split(","));
  return SOURCES.filter((source) => wanted.has(source));
}

/** How one fact is known, in a few words: "7 people · Certificate". */
export function factEvidence(state: Pick<FactState, "streak" | "sources" | "disputed">): string {
  if (state.disputed) return "Sources disagree";
  const parts: string[] = [];
  for (const source of state.sources ?? []) {
    if (source === "community") parts.push(state.streak === 1 ? "1 person" : `${state.streak} people`);
    else parts.push(SOURCE_LABEL[source]);
  }
  return parts.join(" · ");
}

/**
 * The facts a map listing's halal claim implies. "Only" means every dish is
 * halal, so no pork; "yes" (halal options) and "no" imply nothing about the
 * four facts and are kept as context.
 */
export function listingFacts(claim: ListingClaim): Partial<Record<Fact, Definite>> {
  return claim === "only" ? { pork: "no" } : {};
}

/** Read OpenStreetMap's `diet:halal` value. `limited` is treated as `yes`. */
export function parseListingClaim(value: unknown): ListingClaim | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "only") return "only";
  if (normalized === "yes" || normalized === "limited") return "yes";
  if (normalized === "no") return "no";
  return null;
}
