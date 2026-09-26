/**
 * Places can only be added by picking a Google Maps result. The name,
 * address, city and coordinates all come from Google on the server, so
 * nothing about the listing is typed in by hand.
 */
export const PLACE_SUBMISSION_MODES = ["google"] as const;
export type PlaceSubmissionMode = (typeof PLACE_SUBMISSION_MODES)[number];

export type ValidatedPlaceSubmission = {
  mode: PlaceSubmissionMode;
  googlePlaceId: string;
  halalConfirmed: true;
};

export type ValidationResult =
  | { ok: true; data: ValidatedPlaceSubmission }
  | { ok: false; error: string };

export type GooglePlaceQueryResult =
  | { ok: true; query: string }
  | { ok: false; error: string };

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(
  value: unknown,
  label: string,
  maxLength: number,
): { value: string } | { error: string } {
  if (typeof value !== "string") return { error: `Enter a ${label}.` };
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return { error: `Enter a ${label}.` };
  if (normalized.length > maxLength)
    return { error: `${label} must be ${maxLength} characters or fewer.` };
  if (/[\u0000-\u001f\u007f]/.test(normalized))
    return { error: `${label} contains unsupported characters.` };
  return { value: normalized };
}

/** Match the lowercase kebab-case convention used by city page segments. */
export function slugifyCity(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/, "");
}

function optionalGooglePlaceId(
  value: unknown,
): { value: string | null } | { error: string } {
  if (value === undefined || value === null || value === "")
    return { value: null };
  if (typeof value !== "string")
    return { error: "Google place id must be text." };
  const normalized = value.trim();
  if (!normalized) return { value: null };
  if (normalized.length > 300)
    return { error: "Google place id is too long." };
  if (/[\u0000-\u001f\u007f]/.test(normalized))
    return { error: "Google place id contains unsupported characters." };
  return { value: normalized };
}

/** Validate and normalize the JSON contract used by POST /api/places. */
export function validatePlaceSubmission(body: unknown): ValidationResult {
  const input = objectValue(body);
  if (!input) return { ok: false, error: "Send a JSON object." };

  if (input.mode !== "google")
    return {
      ok: false,
      error: "Pick the place from Google Maps. Places can’t be typed in by hand.",
    };
  if (input.halalConfirmed !== true)
    return {
      ok: false,
      error: "You must confirm that this place is halal before submitting.",
    };

  const googlePlaceId = optionalGooglePlaceId(input.googlePlaceId);
  if ("error" in googlePlaceId) return { ok: false, error: googlePlaceId.error };
  if (!googlePlaceId.value)
    return { ok: false, error: "Choose a place from Google search first." };

  return {
    ok: true,
    data: { mode: "google", googlePlaceId: googlePlaceId.value, halalConfirmed: true },
  };
}

export function validateGooglePlaceQuery(value: unknown): GooglePlaceQueryResult {
  const query = textValue(value, "search", 120);
  if ("error" in query) return { ok: false, error: query.error };
  if (query.value.length < 2)
    return { ok: false, error: "Search must contain 2–120 characters." };
  return { ok: true, query: query.value };
}
