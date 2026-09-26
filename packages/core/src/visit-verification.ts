/**
 * Verifying that a dining experience probably happened, without making the
 * restaurant the gatekeeper and without keeping the raw proof.
 *
 * Privacy rule, enforced by the return types below: the caller receives a
 * derived result — method, confidence and a short human-readable detail — and
 * never a coordinate pair, a receipt total or an item list to persist. The
 * raw values exist only for the duration of one request.
 */

export const VERIFICATION_METHODS = [
  "none",
  "location",
  "receipt",
  "reservation",
  "payment",
] as const;

export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export type VerificationConfidence = "none" | "low" | "medium" | "high";

export type VerificationResult = {
  method: VerificationMethod;
  confidence: VerificationConfidence;
  /** Shown on the visit; deliberately carries no precise location or amount. */
  detail: string;
};

/** Device presence must be this close to the venue to count. */
export const LOCATION_PROOF_RADIUS_M = 250;
/** …and the check must arrive within this window of the stated visit time. */
export const LOCATION_PROOF_WINDOW_MS = 3 * 60 * 60 * 1000;
/** Dining hours a location proof is considered plausible within, local time. */
export const PLAUSIBLE_DINING_HOURS = { start: 6, end: 26 } as const;

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Hours run past midnight for late-night dining; 26 means 2am the next day. */
export function withinDiningHours(
  visitedAt: number,
  utcOffsetMinutes: number,
): boolean {
  const local = new Date(visitedAt + utcOffsetMinutes * 60_000);
  const hour = local.getUTCHours();
  const { start, end } = PLAUSIBLE_DINING_HOURS;
  return hour >= start || hour < end - 24;
}

export type LocationProofInput = {
  device: { lat: number; lng: number; accuracyMeters?: number | null };
  place: { lat: number | null; lng: number | null };
  visitedAt: number;
  now: number;
  utcOffsetMinutes?: number;
};

export type ManualVisitReason =
  | "no-proof-offered"
  | "too-far"
  | "outside-window"
  | "implausible-hours"
  | "place-has-no-coordinates"
  | "inaccurate-fix";

export type LocationProofOutcome =
  | { ok: true; result: VerificationResult }
  | { ok: false; reason: ManualVisitReason };

/**
 * Presence near the venue during plausible dining hours. A failure is never an
 * error: it downgrades the visit to a clearly labelled manual one.
 */
export function verifyByLocation(
  input: LocationProofInput,
): LocationProofOutcome {
  const { device, place, visitedAt, now } = input;
  if (
    typeof place.lat !== "number" ||
    typeof place.lng !== "number" ||
    !Number.isFinite(place.lat) ||
    !Number.isFinite(place.lng)
  )
    return { ok: false, reason: "place-has-no-coordinates" };

  if (
    !Number.isFinite(device.lat) ||
    !Number.isFinite(device.lng) ||
    Math.abs(device.lat) > 90 ||
    Math.abs(device.lng) > 180
  )
    return { ok: false, reason: "no-proof-offered" };

  const accuracy = device.accuracyMeters ?? 0;
  if (accuracy > LOCATION_PROOF_RADIUS_M)
    return { ok: false, reason: "inaccurate-fix" };

  if (Math.abs(now - visitedAt) > LOCATION_PROOF_WINDOW_MS)
    return { ok: false, reason: "outside-window" };

  if (!withinDiningHours(visitedAt, input.utcOffsetMinutes ?? 0))
    return { ok: false, reason: "implausible-hours" };

  const distance = distanceMeters(device, {
    lat: place.lat,
    lng: place.lng,
  });
  if (distance > LOCATION_PROOF_RADIUS_M) return { ok: false, reason: "too-far" };

  // Only the bucket survives the request, never the coordinates themselves.
  const confidence: VerificationConfidence =
    distance <= 75 && accuracy <= 50 ? "high" : "medium";
  return {
    ok: true,
    result: {
      method: "location",
      confidence,
      detail: "Device was near the venue during plausible dining hours.",
    },
  };
}

export const RECEIPT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

export type ReceiptInput = {
  contentType: string;
  byteSize: number;
  /** Optional details the submitter chose to share; sensitive lines may be hidden. */
  declared?: {
    venueNameMatches?: boolean;
    visitDateMatches?: boolean;
  };
};

export type ReceiptOutcome =
  | { ok: true; result: VerificationResult }
  | { ok: false; error: string };

export function verifyByReceipt(input: ReceiptInput): ReceiptOutcome {
  if (!(RECEIPT_CONTENT_TYPES as readonly string[]).includes(input.contentType))
    return { ok: false, error: "Upload a JPEG, PNG, WebP or PDF receipt." };
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > MAX_RECEIPT_BYTES
  )
    return { ok: false, error: "The receipt must be between 1 byte and 8 MB." };

  const matches =
    (input.declared?.venueNameMatches ? 1 : 0) +
    (input.declared?.visitDateMatches ? 1 : 0);
  const confidence: VerificationConfidence =
    matches === 2 ? "high" : matches === 1 ? "medium" : "low";
  return {
    ok: true,
    result: {
      method: "receipt",
      confidence,
      detail: "A receipt for this visit was uploaded and kept private.",
    },
  };
}

export const MANUAL_VISIT: VerificationResult = {
  method: "none",
  confidence: "none",
  detail: "Unverified visit. Recorded by the diner without independent proof.",
};

export const MANUAL_REASON_COPY: Record<ManualVisitReason, string> = {
  "no-proof-offered": "No location was shared, so the visit stays unverified.",
  "too-far": "Your device was too far from the venue to verify the visit.",
  "outside-window": "Location proof only works within three hours of the visit.",
  "implausible-hours": "The visit time falls outside plausible dining hours.",
  "place-has-no-coordinates": "This place has no coordinates yet, so location proof is unavailable.",
  "inaccurate-fix": "The location fix was not accurate enough to verify the visit.",
};

/** Verified visits weigh more than unverified ones in every aggregate. */
export function isVerifiedVisit(result: {
  method: VerificationMethod;
  confidence: VerificationConfidence;
}): boolean {
  return result.method !== "none" && result.confidence !== "none";
}

export const VERIFICATION_WEIGHT: Record<VerificationConfidence, number> = {
  high: 1,
  medium: 0.75,
  low: 0.5,
  none: 0.25,
};
