/**
 * Places can only be added by picking a Google Maps result. The name,
 * address, city and coordinates all come from Google on the server, so
 * nothing about the listing is typed in by hand.
 */
export const PLACE_SUBMISSION_MODES = ["google", "link"] as const;
export type PlaceSubmissionMode = (typeof PLACE_SUBMISSION_MODES)[number];

export type ValidatedGoogleSubmission = {
  mode: "google";
  googlePlaceId: string;
  halalConfirmed: true;
};

/** A maps or website link held for review. It does not publish a listing. */
export type ValidatedLinkSubmission = {
  mode: "link";
  name: string;
  city: string;
  citySlug: string;
  address: string;
  sourceUrl: string;
  googlePlaceId: string | null;
  halalConfirmed: true;
};

export type ValidatedPlaceSubmission = ValidatedGoogleSubmission | ValidatedLinkSubmission;

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

function httpsUrl(value: unknown): { value: string } | { error: string } {
  if (typeof value !== "string") return { error: "Paste a link to the place." };
  const normalized = value.trim();
  if (!normalized) return { error: "Paste a link to the place." };
  if (normalized.length > 500) return { error: "That link is too long." };
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return { error: "Paste a full https link to the place." };
  }
  if (url.protocol !== "https:") return { error: "The link must start with https." };
  return { value: url.toString() };
}

/** Pull a Google place id out of a maps link, when the link actually has one. */
export function googlePlaceIdFromUrl(value: string): string | null {
  const placeId = value.match(/place_id(?:=|%3D|:)([A-Za-z0-9_-]{8,})/i);
  if (placeId) return placeId[1];
  const query = value.match(/[?&](?:query_place_id|place_id)=([A-Za-z0-9_-]{8,})/i);
  if (query) return query[1];
  return null;
}

/** Validate and normalize the JSON contract used by POST /api/places. */
export function validatePlaceSubmission(body: unknown): ValidationResult {
  const input = objectValue(body);
  if (!input) return { ok: false, error: "Send a JSON object." };

  if (input.mode !== "google" && input.mode !== "link")
    return {
      ok: false,
      error: "Pick a Google result, or send a place link for a moderator to review.",
    };
  if (input.halalConfirmed !== true)
    return {
      ok: false,
      error: "You must confirm that this place is halal before submitting.",
    };

  if (input.mode === "link") {
    const name = textValue(input.name, "place name", 120);
    if ("error" in name) return { ok: false, error: name.error };
    const city = textValue(input.city, "city", 80);
    if ("error" in city) return { ok: false, error: city.error };
    const citySlug = slugifyCity(city.value);
    if (!citySlug) return { ok: false, error: "Enter the city in Latin letters so we can file it." };
    const address = textValue(input.address, "street address", 200);
    if ("error" in address) return { ok: false, error: address.error };
    const sourceUrl = httpsUrl(input.sourceUrl);
    if ("error" in sourceUrl) return { ok: false, error: sourceUrl.error };
    return {
      ok: true,
      data: {
        mode: "link",
        name: name.value,
        city: city.value,
        citySlug,
        address: address.value,
        sourceUrl: sourceUrl.value,
        googlePlaceId: googlePlaceIdFromUrl(sourceUrl.value),
        halalConfirmed: true,
      },
    };
  }

  const googlePlaceId = optionalGooglePlaceId(input.googlePlaceId);
  if ("error" in googlePlaceId) return { ok: false, error: googlePlaceId.error };
  if (!googlePlaceId.value)
    return { ok: false, error: "Choose a place from Google search first." };

  return {
    ok: true,
    data: { mode: "google", googlePlaceId: googlePlaceId.value, halalConfirmed: true },
  };
}

/** Places Text Search is skipped until the trimmed query is at least this long. */
export const GOOGLE_PLACE_QUERY_MIN_LENGTH = 3;
export const GOOGLE_PLACE_QUERY_MAX_LENGTH = 120;

export function validateGooglePlaceQuery(value: unknown): GooglePlaceQueryResult {
  const query = textValue(value, "search", GOOGLE_PLACE_QUERY_MAX_LENGTH);
  if ("error" in query) return { ok: false, error: query.error };
  if (query.value.length < GOOGLE_PLACE_QUERY_MIN_LENGTH)
    return {
      ok: false,
      error: `Search must contain ${GOOGLE_PLACE_QUERY_MIN_LENGTH}–${GOOGLE_PLACE_QUERY_MAX_LENGTH} characters.`,
    };
  return { ok: true, query: query.value };
}
