/**
 * Places can only be added by picking a Google Maps result. The name,
 * address, city and coordinates all come from Google on the server, so
 * nothing about the listing is typed in by hand. The adder may answer the four
 * halal questions; those answers are stored as the place's first check.
 */
import { ANSWERS, FACTS, type Answer, type Fact } from "./halal";

export type ValidatedPlaceSubmission = {
  googlePlaceId: string;
  /**
   * Name, address and city from the result the person picked. Place Details
   * still wins when it can be called; these are used only when it is skipped.
   */
  name: string | null;
  address: string | null;
  city: string | null;
  /** Null when the adder answered nothing definite. */
  answers: Record<Fact, Answer> | null;
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
  const googlePlaceId = optionalGooglePlaceId(input.googlePlaceId);
  if ("error" in googlePlaceId) return { ok: false, error: googlePlaceId.error };
  if (!googlePlaceId.value) return { ok: false, error: "Choose a place from Google search first." };

  let answers: Record<Fact, Answer> | null = null;
  const raw = objectValue(input.answers);
  if (raw) {
    answers = {} as Record<Fact, Answer>;
    for (const fact of FACTS) {
      const value = raw[fact];
      if (value === undefined || value === null || value === "") answers[fact] = null;
      else if ((ANSWERS as readonly unknown[]).includes(value)) answers[fact] = value as Answer;
      else return { ok: false, error: `Unknown answer for ${fact}.` };
    }
    if (!FACTS.some((fact) => answers![fact] === "yes" || answers![fact] === "no")) answers = null;
  }

  return {
    ok: true,
    data: {
      googlePlaceId: googlePlaceId.value,
      name: optionalSubmissionText(input.name, 120),
      address: optionalSubmissionText(input.address, 200),
      city: optionalSubmissionText(input.city, 80),
      answers,
    },
  };
}

/** Keep a picker field when it is usable. Overlong text is clipped to the submission column. */
function optionalSubmissionText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized.slice(0, maxLength);
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
