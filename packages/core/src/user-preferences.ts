/**
 * Dietary standards and the suitability check that applies them.
 *
 * The platform does not declare one universal religious standard. It exposes
 * the evidence and lets each user set their own thresholds; `evaluateSuitability`
 * reports which of *their* rules a place fails, and never invents a verdict
 * from absence of information.
 */

import {
  HALAL_STATUSES,
  meetsMinimumStatus,
  STATUS_COPY,
  type HalalAssessment,
  type HalalTaxonomyStatus,
} from "./halal-taxonomy";
import { FACT_COPY, type PlaceFacts } from "./place-facts";

export type MinimumStatus = Exclude<HalalTaxonomyStatus, "not-halal">;

export const MINIMUM_STATUS_OPTIONS: MinimumStatus[] = HALAL_STATUSES.filter(
  (status): status is MinimumStatus => status !== "not-halal",
);

export type UserPreferences = {
  minimumStatus: MinimumStatus;
  requireCertification: boolean;
  avoidAlcohol: boolean;
  avoidPork: boolean;
  requireDedicatedKitchen: boolean;
  requirePrayerSpace: boolean;
  vegetarianOnly: boolean;
  maxEvidenceAgeDays: number | null;
  allergies: string[];
  cuisines: string[];
  homeCitySlug: string | null;
  visibilityVisits: "public" | "private";
  visibilityLists: "public" | "private";
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  minimumStatus: "self-declared",
  requireCertification: false,
  avoidAlcohol: false,
  avoidPork: false,
  requireDedicatedKitchen: false,
  requirePrayerSpace: false,
  vegetarianOnly: false,
  maxEvidenceAgeDays: null,
  allergies: [],
  cuisines: [],
  homeCitySlug: null,
  visibilityVisits: "public",
  visibilityLists: "public",
};

export type PreferencesValidation =
  | { ok: true; data: UserPreferences }
  | { ok: false; error: string };

function boolOf(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return value === true;
}

function tagList(value: unknown, max: number, label: string): string[] | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return `${label} must be an array.`;
  if (value.length > max) return `Choose at most ${max} ${label.toLowerCase()}.`;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return `${label} must be strings.`;
    const text = item.trim().toLowerCase();
    if (!text || text.length > 40) return `Each entry in ${label.toLowerCase()} must be 1-40 characters.`;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

export function validatePreferences(input: unknown): PreferencesValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  const minimumStatus = body.minimumStatus ?? DEFAULT_PREFERENCES.minimumStatus;
  if (!MINIMUM_STATUS_OPTIONS.includes(minimumStatus as MinimumStatus))
    return { ok: false, error: "Choose a minimum halal status from the taxonomy." };

  let maxEvidenceAgeDays: number | null = null;
  if (body.maxEvidenceAgeDays !== undefined && body.maxEvidenceAgeDays !== null) {
    const days = body.maxEvidenceAgeDays;
    if (!Number.isSafeInteger(days) || (days as number) < 1 || (days as number) > 3650)
      return { ok: false, error: "Evidence age must be between 1 and 3650 days." };
    maxEvidenceAgeDays = days as number;
  }

  const allergies = tagList(body.allergies, 20, "Allergies");
  if (typeof allergies === "string") return { ok: false, error: allergies };
  const cuisines = tagList(body.cuisines, 20, "Cuisines");
  if (typeof cuisines === "string") return { ok: false, error: cuisines };

  let homeCitySlug: string | null = null;
  if (body.homeCitySlug !== undefined && body.homeCitySlug !== null && body.homeCitySlug !== "") {
    if (
      typeof body.homeCitySlug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.homeCitySlug) ||
      body.homeCitySlug.length > 120
    )
      return { ok: false, error: "Home city must be a valid city slug." };
    homeCitySlug = body.homeCitySlug;
  }

  const visibility = (value: unknown, fallback: "public" | "private") => {
    if (value === undefined || value === null) return fallback;
    return value === "private" ? "private" : value === "public" ? "public" : null;
  };
  const visibilityVisits = visibility(body.visibilityVisits, "public");
  const visibilityLists = visibility(body.visibilityLists, "public");
  if (!visibilityVisits || !visibilityLists)
    return { ok: false, error: "Visibility must be public or private." };

  return {
    ok: true,
    data: {
      minimumStatus: minimumStatus as MinimumStatus,
      requireCertification: boolOf(body.requireCertification, false),
      avoidAlcohol: boolOf(body.avoidAlcohol, false),
      avoidPork: boolOf(body.avoidPork, false),
      requireDedicatedKitchen: boolOf(body.requireDedicatedKitchen, false),
      requirePrayerSpace: boolOf(body.requirePrayerSpace, false),
      vegetarianOnly: boolOf(body.vegetarianOnly, false),
      maxEvidenceAgeDays,
      allergies,
      cuisines,
      homeCitySlug,
      visibilityVisits,
      visibilityLists,
    },
  };
}

/* ------------------------------------------------------------ suitability -- */

export type SuitabilityNote = {
  code: string;
  message: string;
};

export type Suitability = {
  /** True only when no rule is broken. Unknown facts are warnings, not blocks. */
  meets: boolean;
  blockers: SuitabilityNote[];
  warnings: SuitabilityNote[];
};

const DAY_MS = 86_400_000;

/**
 * Apply one user's thresholds to one place. A missing fact never becomes a
 * blocker: it becomes a warning, because unknown is not non-halal.
 */
export function evaluateSuitability(
  preferences: UserPreferences,
  assessment: HalalAssessment,
  facts: PlaceFacts,
  now: number = Date.now(),
): Suitability {
  const blockers: SuitabilityNote[] = [];
  const warnings: SuitabilityNote[] = [];

  if (assessment.status === "not-halal")
    blockers.push({
      code: "not-halal",
      message: "Current evidence shows the relevant food here is not halal.",
    });
  else if (!meetsMinimumStatus(assessment.status, preferences.minimumStatus))
    blockers.push({
      code: "below-minimum-status",
      message: `This place is ${STATUS_COPY[assessment.status].label.toLowerCase()}; your standard is ${STATUS_COPY[preferences.minimumStatus].label.toLowerCase()} or stronger.`,
    });

  if (assessment.conflict)
    warnings.push({
      code: "conflicting-evidence",
      message: "The halal evidence here conflicts and is awaiting review.",
    });

  if (preferences.requireCertification && !facts.certificationBody)
    blockers.push({
      code: "no-certification",
      message: "You require a named certification body and none is recorded.",
    });

  if (
    preferences.maxEvidenceAgeDays !== null &&
    assessment.latestEvidenceAt !== null &&
    now - assessment.latestEvidenceAt > preferences.maxEvidenceAgeDays * DAY_MS
  )
    blockers.push({
      code: "evidence-too-old",
      message: `The newest evidence is older than your ${preferences.maxEvidenceAgeDays}-day limit.`,
    });

  const factRule = (
    enabled: boolean,
    key: keyof typeof FACT_COPY,
    failing: "yes" | "no",
    code: string,
  ) => {
    if (!enabled) return;
    const value = facts[key];
    if (value === failing)
      blockers.push({ code, message: `${FACT_COPY[key][failing]} — this breaks one of your standards.` });
    else if (value === "unknown")
      warnings.push({ code: `${code}-unknown`, message: FACT_COPY[key].unknown + "." });
  };

  factRule(preferences.avoidAlcohol, "servesAlcohol", "yes", "serves-alcohol");
  factRule(preferences.avoidPork, "servesPork", "yes", "serves-pork");
  factRule(preferences.requireDedicatedKitchen, "dedicatedHalalKitchen", "no", "shared-kitchen");
  factRule(preferences.requirePrayerSpace, "prayerSpace", "no", "no-prayer-space");
  factRule(preferences.vegetarianOnly, "vegetarianOptions", "no", "no-vegetarian");

  if (preferences.allergies.length)
    warnings.push({
      code: "allergies",
      message: `Confirm your allergies with the restaurant directly: ${preferences.allergies.join(", ")}.`,
    });

  return { meets: blockers.length === 0, blockers, warnings };
}
