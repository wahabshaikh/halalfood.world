export const PLACE_SUBMISSION_MODES = ["google", "manual"] as const;
export type PlaceSubmissionMode = (typeof PLACE_SUBMISSION_MODES)[number];

export type ValidatedPlaceSubmission = {
  mode: PlaceSubmissionMode;
  name: string;
  address: string;
  city: string;
  citySlug: string;
  googlePlaceId: string | null;
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

  const mode = input.mode;
  if (mode !== "google" && mode !== "manual")
    return { ok: false, error: "Choose Google search or manual entry." };
  if (input.halalConfirmed !== true) {
    return {
      ok: false,
      error: "You must confirm that this place is halal before submitting.",
    };
  }

  const name = textValue(input.name, "place name", 200);
  if ("error" in name) return { ok: false, error: name.error };
  const address = textValue(input.address, "street address", 300);
  if ("error" in address) return { ok: false, error: address.error };
  const city = textValue(input.city, "city or locality", 120);
  if ("error" in city) return { ok: false, error: city.error };

  const citySlug = slugifyCity(city.value);
  if (!citySlug)
    return {
      ok: false,
      error: "Enter a city using letters or numbers so it can be listed.",
    };

  const googlePlaceId = optionalGooglePlaceId(input.googlePlaceId);
  if ("error" in googlePlaceId) return { ok: false, error: googlePlaceId.error };
  if (mode === "google" && !googlePlaceId.value)
    return { ok: false, error: "Choose a place from Google search first." };

  return {
    ok: true,
    data: {
      mode,
      name: name.value,
      address: address.value,
      city: city.value,
      citySlug,
      googlePlaceId: googlePlaceId.value,
      halalConfirmed: true,
    },
  };
}

export function validateGooglePlaceQuery(value: unknown): GooglePlaceQueryResult {
  const query = textValue(value, "search", 120);
  if ("error" in query) return { ok: false, error: query.error };
  if (query.value.length < 2)
    return { ok: false, error: "Search must contain 2–120 characters." };
  return { ok: true, query: query.value };
}
