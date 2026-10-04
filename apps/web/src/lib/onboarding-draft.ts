import {
  ONBOARDING_STEPS,
  STANDARD_PRESETS,
  type OnboardingStandard,
  type OnboardingStep,
  type StandardPreset,
} from "@halalfood/core/social";
import { safeReturnPath } from "./signed-out";
import { clearFormDraft, draftRecord, readFormDraft, saveFormDraft } from "./form-draft";

export const ONBOARDING_DRAFT_KEY = "halalfood:onboarding-draft:v1";

/** What a reload in the middle of onboarding must not lose. */
export type OnboardingDraft = {
  /** The account the draft belongs to, so another sign-in in this tab starts clean. */
  owner: string;
  step: Exclude<OnboardingStep, "ready">;
  displayName: string;
  handle: string;
  homeCity: string | null;
  standard: OnboardingStandard;
  standardTouched: boolean;
  chosen: string[];
};

const MAX_TEXT = 200;

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : "";
}

/** Validate a stored draft. Anything malformed is dropped, never half-applied. */
export function parseOnboardingDraft(value: unknown): OnboardingDraft | null {
  const draft = draftRecord(value);
  if (!draft) return null;
  const step = draft.step;
  if (
    typeof step !== "string" ||
    step === "ready" ||
    !ONBOARDING_STEPS.includes(step as OnboardingStep)
  ) {
    return null;
  }
  const rawStandard = draftRecord(draft.standard);
  const preset = rawStandard?.preset;
  const standard: OnboardingStandard = {
    preset: STANDARD_PRESETS.includes(preset as StandardPreset)
      ? (preset as StandardPreset)
      : "community",
    avoidAlcohol: rawStandard?.avoidAlcohol === true,
    preferHandSlaughter: rawStandard?.preferHandSlaughter === true,
  };
  const chosen = Array.isArray(draft.chosen)
    ? draft.chosen.filter((id): id is string => typeof id === "string").slice(0, 50)
    : [];
  if (typeof draft.owner !== "string" || !draft.owner) return null;
  return {
    owner: draft.owner,
    step: step as OnboardingDraft["step"],
    displayName: text(draft.displayName),
    handle: text(draft.handle),
    homeCity: text(draft.homeCity) || null,
    standard,
    standardTouched: draft.standardTouched === true,
    chosen,
  };
}

export function readOnboardingDraft(owner: string): OnboardingDraft | null {
  const draft = parseOnboardingDraft(readFormDraft(ONBOARDING_DRAFT_KEY));
  if (draft && draft.owner !== owner) {
    clearOnboardingDraft();
    return null;
  }
  return draft;
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  saveFormDraft(ONBOARDING_DRAFT_KEY, draft);
}

export function clearOnboardingDraft(): void {
  clearFormDraft(ONBOARDING_DRAFT_KEY);
}

/**
 * Where "Let me in" goes when onboarding started from somewhere specific: a
 * Save on a place page sends `/login?reason=save&returnTo=/place/…`, and the
 * login form forwards that returnTo here. Null means "open the map".
 * Only same-origin paths; never home, login or onboarding itself.
 */
export function onboardingResumeHref(returnTo: string | null | undefined): string | null {
  const path = safeReturnPath(returnTo, "");
  if (!path) return null;
  if (path === "/" || /^\/(?:login|onboarding)(?:[/?#]|$)/.test(path)) return null;
  return path;
}
