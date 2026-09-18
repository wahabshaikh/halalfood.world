/**
 * The provenance layer: dated, sourced, append-only observations.
 *
 * Two of the platform's non-negotiable principles live here:
 *
 * - **Every important fact carries provenance and an observation date.** A
 *   value without a source and a date is not a fact this system will publish;
 *   `projectFacts` returns the source and date alongside every value so the UI
 *   can show them together.
 * - **Historical values are appended, not overwritten.** A change is a new
 *   observation with a later `observedAt`. Nothing in this module updates a
 *   value in place, which is what makes price history, certification changes
 *   and ownership changes visible rather than silently replaced.
 *
 * Disagreement is preserved too: when two current observations of the same
 * predicate disagree, `projectFacts` reports the winner *and* the dissenting
 * observations rather than averaging them away.
 */

export const SOURCE_CLASSES = [
  "open-data",
  "official-api",
  "government",
  "restaurant-owned",
  "editorial",
  "community",
  "commercial-platform",
  "search-extraction",
] as const;

export type SourceClass = (typeof SOURCE_CLASSES)[number];

export type ObservationConfidence = "high" | "medium" | "low";

/**
 * How much weight a class of source carries when two observations disagree.
 * Government records and official APIs outrank a platform scrape; a
 * restaurant's own page outranks an editorial mention for *factual* claims
 * like hours and menu prices, which is what these predicates are.
 */
export const SOURCE_CLASS_WEIGHT: Record<SourceClass, number> = {
  government: 6,
  "official-api": 5,
  "restaurant-owned": 4,
  "open-data": 3,
  community: 3,
  editorial: 2,
  "commercial-platform": 2,
  "search-extraction": 1,
};

export const SOURCE_CLASS_COPY: Record<SourceClass, string> = {
  "open-data": "Open data",
  "official-api": "Official API",
  government: "Government record",
  "restaurant-owned": "The restaurant's own page",
  editorial: "Editorial",
  community: "Community contribution",
  "commercial-platform": "Commercial platform",
  "search-extraction": "Web extraction",
};

/** How long a predicate stays current when an observation declares no expiry. */
export const PREDICATE_TTL_DAYS: Record<string, number> = {
  telephone: 365,
  website: 365,
  openingHours: 120,
  menuUrl: 180,
  priceBand: 365,
  servesAlcohol: 365,
  servesPork: 365,
  dedicatedHalalKitchen: 270,
  muslimOwned: 540,
  prayerSpace: 365,
  womenFriendlyFacilities: 365,
  vegetarianOptions: 365,
  certificationBody: 365,
  neighbourhood: 1095,
  dishPrice: 120,
};

export const DEFAULT_PREDICATE_TTL_DAYS = 365;

const DAY_MS = 86_400_000;

export type Observation = {
  id: string;
  predicate: string;
  value: string;
  source: string;
  sourceClass: SourceClass;
  sourceUrl: string | null;
  observedAt: number;
  validUntil: number | null;
  confidence: ObservationConfidence;
  submittedByUserId?: string | null;
};

export type ObservedFact = {
  predicate: string;
  value: string;
  source: string;
  sourceClass: SourceClass;
  sourceUrl: string | null;
  observedAt: number;
  validUntil: number;
  confidence: ObservationConfidence;
  /** True once the observation has passed its validity window. */
  stale: boolean;
  /** Current observations that disagree with the published value. */
  disagreeing: Observation[];
  /** Every observation for this predicate, newest first — the history. */
  history: Observation[];
};

export function isSourceClass(value: unknown): value is SourceClass {
  return (
    typeof value === "string" &&
    (SOURCE_CLASSES as readonly string[]).includes(value)
  );
}

export function effectiveValidUntil(observation: Observation): number {
  if (
    typeof observation.validUntil === "number" &&
    Number.isFinite(observation.validUntil)
  )
    return observation.validUntil;
  const days =
    PREDICATE_TTL_DAYS[observation.predicate] ?? DEFAULT_PREDICATE_TTL_DAYS;
  return observation.observedAt + days * DAY_MS;
}

const CONFIDENCE_WEIGHT: Record<ObservationConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Rank two competing observations. Source class dominates, then declared
 * confidence, then recency — a fresh scrape never outranks a government record,
 * but between equals the newer reading wins.
 */
export function compareObservations(a: Observation, b: Observation): number {
  const byClass =
    SOURCE_CLASS_WEIGHT[b.sourceClass] - SOURCE_CLASS_WEIGHT[a.sourceClass];
  if (byClass) return byClass;
  const byConfidence =
    CONFIDENCE_WEIGHT[b.confidence] - CONFIDENCE_WEIGHT[a.confidence];
  if (byConfidence) return byConfidence;
  return b.observedAt - a.observedAt;
}

/**
 * Collapse an append-only observation log into the currently published facts,
 * keeping provenance, dates, staleness and disagreement attached to each one.
 */
export function projectFacts(
  observations: readonly Observation[],
  now: number = Date.now(),
): Map<string, ObservedFact> {
  const byPredicate = new Map<string, Observation[]>();
  for (const observation of observations) {
    const list = byPredicate.get(observation.predicate) ?? [];
    list.push(observation);
    byPredicate.set(observation.predicate, list);
  }

  const facts = new Map<string, ObservedFact>();
  for (const [predicate, list] of byPredicate) {
    const history = [...list].sort((a, b) => b.observedAt - a.observedAt);
    const current = history.filter(
      (observation) => effectiveValidUntil(observation) > now,
    );
    // Nothing current: publish the newest reading, flagged stale, so the page
    // shows a dated fact with a revalidation prompt rather than nothing.
    const pool = current.length ? current : history.slice(0, 1);
    const ranked = [...pool].sort(compareObservations);
    const winner = ranked[0];
    if (!winner) continue;

    facts.set(predicate, {
      predicate,
      value: winner.value,
      source: winner.source,
      sourceClass: winner.sourceClass,
      sourceUrl: winner.sourceUrl,
      observedAt: winner.observedAt,
      validUntil: effectiveValidUntil(winner),
      confidence: winner.confidence,
      stale: !current.length,
      disagreeing: ranked.slice(1).filter((item) => item.value !== winner.value),
      history,
    });
  }
  return facts;
}

/** Human-readable age, for the "last checked" line beside every fact. */
export function formatObservedAge(observedAt: number, now: number): string {
  const days = Math.floor((now - observedAt) / DAY_MS);
  if (days <= 0) return "checked today";
  if (days === 1) return "checked yesterday";
  if (days < 30) return `checked ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `checked ${months} month${months === 1 ? "" : "s"} ago`;
  return `checked ${Math.floor(days / 365)} years ago`;
}

export type ObservationInput = {
  predicate: string;
  value: string;
  source: string;
  sourceClass: SourceClass;
  sourceUrl?: string | null;
  observedAt?: number;
  validUntil?: number | null;
  confidence?: ObservationConfidence;
};

export type ObservationValidation =
  | { ok: true; data: Required<Omit<ObservationInput, "validUntil">> & { validUntil: number | null } }
  | { ok: false; error: string };

/** Validate one observation before it is appended. */
export function validateObservation(
  input: unknown,
  now: number = Date.now(),
): ObservationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  if (typeof body.predicate !== "string" || !body.predicate.trim())
    return { ok: false, error: "An observation needs a predicate." };
  const predicate = body.predicate.trim();
  if (predicate.length > 60)
    return { ok: false, error: "The predicate must be 60 characters or fewer." };

  if (typeof body.value !== "string" || !body.value.trim())
    return { ok: false, error: "An observation needs a value." };
  const value = body.value.trim();
  if (value.length > 2000)
    return { ok: false, error: "The value must be 2000 characters or fewer." };

  if (typeof body.source !== "string" || !body.source.trim())
    return { ok: false, error: "An observation needs a named source." };
  const source = body.source.trim().slice(0, 120);

  if (!isSourceClass(body.sourceClass))
    return { ok: false, error: "An observation needs a known source class." };

  let sourceUrl: string | null = null;
  if (body.sourceUrl !== undefined && body.sourceUrl !== null && body.sourceUrl !== "") {
    if (typeof body.sourceUrl !== "string" || body.sourceUrl.length > 2000)
      return { ok: false, error: "The source link is not usable." };
    try {
      const url = new URL(body.sourceUrl);
      if (!["http:", "https:"].includes(url.protocol))
        return { ok: false, error: "The source link must be http(s)." };
      sourceUrl = url.href;
    } catch {
      return { ok: false, error: "The source link is not a valid URL." };
    }
  }

  let observedAt = now;
  if (body.observedAt !== undefined && body.observedAt !== null) {
    if (
      typeof body.observedAt !== "number" ||
      !Number.isFinite(body.observedAt) ||
      body.observedAt > now + DAY_MS ||
      body.observedAt < now - 20 * 365 * DAY_MS
    )
      return { ok: false, error: "The observation date is not plausible." };
    observedAt = body.observedAt;
  }

  let validUntil: number | null = null;
  if (body.validUntil !== undefined && body.validUntil !== null) {
    if (
      typeof body.validUntil !== "number" ||
      !Number.isFinite(body.validUntil) ||
      body.validUntil <= observedAt
    )
      return { ok: false, error: "The validity date must be after the observation date." };
    validUntil = body.validUntil;
  }

  const confidence = body.confidence ?? "medium";
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low")
    return { ok: false, error: "Confidence must be high, medium or low." };

  return {
    ok: true,
    data: {
      predicate,
      value,
      source,
      sourceClass: body.sourceClass,
      sourceUrl,
      observedAt,
      validUntil,
      confidence,
    },
  };
}
