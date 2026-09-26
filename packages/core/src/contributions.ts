/**
 * Community contributions: factual edits, dishes and duplicate reports.
 *
 * Contribution status is always visible to the contributor, with a reason —
 * pending, accepted, needs evidence, rejected or superseded.
 */

import { isRelationship, type Relationship } from "./halal-taxonomy";
import { normalizeDishName } from "./check-in";

export const CONTRIBUTION_STATUSES = [
  "pending",
  "accepted",
  "needs-evidence",
  "rejected",
  "superseded",
] as const;

export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export const CONTRIBUTION_STATUS_COPY: Record<ContributionStatus, string> = {
  pending: "Pending review",
  accepted: "Accepted",
  "needs-evidence": "Needs evidence",
  rejected: "Rejected",
  superseded: "Superseded by a newer submission",
};

/** Fields a visitor may propose a correction to. */
export const EDITABLE_FIELDS = [
  "name",
  "streetAddress",
  "addressLocality",
  "telephone",
  "website",
  "neighbourhood",
  "priceBand",
  "serviceTypes",
  "meals",
  "menuUrl",
  "reservationUrl",
  "deliveryUrl",
  "branchLabel",
  "servesAlcohol",
  "servesPork",
  "dedicatedHalalKitchen",
  "muslimOwned",
  "prayerSpace",
  "womenFriendlyFacilities",
  "vegetarianOptions",
  "certificationBody",
  "permanentlyClosed",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const EDITABLE_FIELD_COPY: Record<EditableField, string> = {
  name: "Restaurant name",
  streetAddress: "Street address",
  addressLocality: "Locality",
  telephone: "Phone number",
  website: "Website",
  neighbourhood: "Neighbourhood",
  priceBand: "Price range",
  serviceTypes: "Service types",
  meals: "Meals served",
  menuUrl: "Menu link",
  reservationUrl: "Reservation link",
  deliveryUrl: "Delivery link",
  branchLabel: "Branch name",
  servesAlcohol: "Alcohol",
  servesPork: "Pork",
  dedicatedHalalKitchen: "Dedicated halal kitchen",
  muslimOwned: "Muslim-owned",
  prayerSpace: "Prayer space",
  womenFriendlyFacilities: "Women-friendly facilities",
  vegetarianOptions: "Vegetarian options",
  certificationBody: "Certification body",
  permanentlyClosed: "Permanently closed",
};

/**
 * Fields whose value changes a halal conclusion or a ranking input always go to
 * moderation; the rest can be auto-accepted from reliable contributors.
 */
export const SENSITIVE_FIELDS: ReadonlySet<EditableField> = new Set([
  "servesAlcohol",
  "servesPork",
  "dedicatedHalalKitchen",
  "certificationBody",
  "permanentlyClosed",
  "name",
]);

export type ValidatedEditSuggestion = {
  field: EditableField;
  proposedValue: string;
  sourceUrl: string | null;
  note: string | null;
  relationship: Relationship;
};

export type EditValidation =
  | { ok: true; data: ValidatedEditSuggestion }
  | { ok: false; error: string };

function httpUrl(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : false;
  } catch {
    return false;
  }
}

export function validateEditSuggestion(input: unknown): EditValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  if (!(EDITABLE_FIELDS as readonly unknown[]).includes(body.field))
    return { ok: false, error: "Choose a field that can be corrected." };
  const field = body.field as EditableField;

  if (typeof body.proposedValue !== "string")
    return { ok: false, error: "Send the corrected value." };
  const proposedValue = body.proposedValue.trim();
  if (!proposedValue || proposedValue.length > 2000)
    return { ok: false, error: "The corrected value must be 1-2000 characters." };

  const sourceUrl = httpUrl(body.sourceUrl);
  if (sourceUrl === false)
    return { ok: false, error: "The source must be an http(s) link." };

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null && body.note !== "") {
    if (typeof body.note !== "string" || body.note.trim().length > 1000)
      return { ok: false, error: "The note must be 1000 characters or fewer." };
    note = body.note.trim() || null;
  }

  const relationship = body.relationship ?? "none";
  if (!isRelationship(relationship))
    return { ok: false, error: "Declare your relationship with the restaurant." };

  if (SENSITIVE_FIELDS.has(field) && !sourceUrl && !note)
    return {
      ok: false,
      error: "Corrections to halal-sensitive facts need a source link or an explanation.",
    };

  return {
    ok: true,
    data: { field, proposedValue, sourceUrl, note, relationship },
  };
}

/**
 * Low-risk edits from a reliable contributor auto-accept; everything else is
 * queued. Reliability is the contributor's own accepted/rejected history.
 */
export function editModerationDecision(input: {
  field: EditableField;
  relationship: Relationship;
  acceptedContributions: number;
  rejectedContributions: number;
}): { autoAccept: boolean; reason: string } {
  if (SENSITIVE_FIELDS.has(input.field))
    return {
      autoAccept: false,
      reason: "This fact changes a halal conclusion, so it is reviewed by a moderator.",
    };
  if (input.relationship !== "none")
    return {
      autoAccept: false,
      reason: "Edits from a declared interested party are always reviewed.",
    };
  if (input.rejectedContributions > 0 && input.acceptedContributions < 10)
    return {
      autoAccept: false,
      reason: "Recent rejected contributions mean this edit is reviewed first.",
    };
  if (input.acceptedContributions >= 5)
    return { autoAccept: true, reason: "Low-risk edit from a reliable contributor." };
  return {
    autoAccept: false,
    reason: "Your first few edits are reviewed before they go live.",
  };
}

/* ----------------------------------------------------------------- dishes -- */

export type ValidatedDish = {
  name: string;
  normalizedName: string;
  cuisine: string | null;
  priceMinor: number | null;
  currency: string | null;
  halalScope: "halal" | "not-halal" | "unknown";
  sourceUrl: string | null;
  capturedAt: number;
};

export type DishValidation =
  | { ok: true; data: ValidatedDish }
  | { ok: false; error: string };

export function validateDish(input: unknown, now = Date.now()): DishValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  if (typeof body.name !== "string")
    return { ok: false, error: "Give the dish a name." };
  const name = body.name.trim();
  if (!name || name.length > 120)
    return { ok: false, error: "The dish name must be 1-120 characters." };
  const normalizedName = normalizeDishName(name);
  if (!normalizedName) return { ok: false, error: "That dish name is not usable." };

  let cuisine: string | null = null;
  if (body.cuisine !== undefined && body.cuisine !== null && body.cuisine !== "") {
    if (typeof body.cuisine !== "string" || body.cuisine.trim().length > 60)
      return { ok: false, error: "The cuisine must be 60 characters or fewer." };
    cuisine = body.cuisine.trim().toLowerCase();
  }

  let priceMinor: number | null = null;
  let currency: string | null = null;
  if (body.priceMinor !== undefined && body.priceMinor !== null) {
    if (
      !Number.isSafeInteger(body.priceMinor) ||
      (body.priceMinor as number) < 0 ||
      (body.priceMinor as number) > 100_000_000
    )
      return { ok: false, error: "The price must be a whole amount in minor units." };
    priceMinor = body.priceMinor as number;
    if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency))
      return { ok: false, error: "Send a three-letter currency alongside the price." };
    currency = body.currency;
  }

  const halalScope = body.halalScope ?? "unknown";
  if (halalScope !== "halal" && halalScope !== "not-halal" && halalScope !== "unknown")
    return { ok: false, error: "Halal scope must be halal, not-halal or unknown." };

  const sourceUrl = httpUrl(body.sourceUrl);
  if (sourceUrl === false)
    return { ok: false, error: "The source must be an http(s) link." };

  let capturedAt = now;
  if (body.capturedAt !== undefined && body.capturedAt !== null) {
    if (
      typeof body.capturedAt !== "number" ||
      !Number.isFinite(body.capturedAt) ||
      body.capturedAt > now + 86_400_000 ||
      body.capturedAt < now - 20 * 365 * 86_400_000
    )
      return { ok: false, error: "The capture date is not plausible." };
    capturedAt = body.capturedAt;
  }

  return {
    ok: true,
    data: {
      name,
      normalizedName,
      cuisine,
      priceMinor,
      currency,
      halalScope: halalScope as ValidatedDish["halalScope"],
      sourceUrl,
      capturedAt,
    },
  };
}

/* ------------------------------------------------------------- duplicates -- */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DuplicateValidation =
  | { ok: true; data: { duplicateOfPlaceId: string; note: string | null } }
  | { ok: false; error: string };

export function validateDuplicateReport(
  placeId: string,
  input: unknown,
): DuplicateValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;
  if (typeof body.duplicateOfPlaceId !== "string" || !UUID.test(body.duplicateOfPlaceId))
    return { ok: false, error: "Point at the place this duplicates." };
  const duplicateOfPlaceId = body.duplicateOfPlaceId.toLowerCase();
  if (duplicateOfPlaceId === placeId.toLowerCase())
    return { ok: false, error: "A place cannot duplicate itself." };

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null && body.note !== "") {
    if (typeof body.note !== "string" || body.note.trim().length > 1000)
      return { ok: false, error: "The note must be 1000 characters or fewer." };
    note = body.note.trim() || null;
  }
  return { ok: true, data: { duplicateOfPlaceId, note } };
}

/**
 * Merging a duplicate must not lose visits, evidence or list memberships. This
 * describes the moves a merge performs so the caller and the audit log agree.
 */
export type MergePlan = {
  keepPlaceId: string;
  mergePlaceId: string;
  moves: Array<{ table: string; column: string }>;
};

export function buildMergePlan(
  keepPlaceId: string,
  mergePlaceId: string,
): MergePlan {
  return {
    keepPlaceId,
    mergePlaceId,
    moves: [
      { table: "place_halal_verifications", column: "place_id" },
      { table: "place_visits", column: "place_id" },
      { table: "place_check_ins", column: "place_id" },
      { table: "place_check_in_dishes", column: "place_id" },
      { table: "place_dishes", column: "place_id" },
      { table: "place_photos", column: "place_id" },
      { table: "place_reviews", column: "place_id" },
      { table: "place_ratings", column: "place_id" },
      { table: "saved_places", column: "place_id" },
      { table: "place_list_items", column: "place_id" },
      { table: "place_edit_suggestions", column: "place_id" },
    ],
  };
}
