import { placeIdParam } from "@halalfood/core/params";
import { validateCheckIn } from "@halalfood/core/check-in";
import {
  MANUAL_VISIT,
  verifyByLocation,
  verifyByReceipt,
  MANUAL_REASON_COPY,
  type VerificationResult,
} from "@halalfood/core/visit-verification";
import {
  getCheckInSummary,
  getDishHighlights,
  listPublicCheckIns,
  recordVisit,
} from "../../../../../src/lib/visits";
import { getPlaceById } from "../../../../../src/lib/places";
import { consumeCheckInLimits } from "../../../../../src/lib/otp-rate-limit";
import { evaluateDisclosure } from "@halalfood/core/anti-manipulation";
import { isSafeEvidenceR2Key } from "../../../../../src/lib/r2";
import {
  INVALID_JSON,
  badRequest,
  json,
  notFound,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";

/**
 * Record a visit and its ten-second check-in.
 *
 * Verification is attempted, never demanded: a failed location proof downgrades
 * the visit to a clearly labelled manual one instead of rejecting it. Only the
 * derived result is persisted — the coordinates in the request body are used
 * for the distance comparison and then dropped.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const placeId = placeIdParam((await context.params).id);
  if (!placeId) return badRequest("Invalid place id.");

  const outcome = await requireUser(request, `/place/${placeId}`);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const input = body as Record<string, unknown>;

  const validation = validateCheckIn(input);
  if (!validation.ok) return badRequest(validation.error);
  const checkIn = validation.data;

  const now = Date.now();
  let visitedAt = now;
  if (input.visitedAt !== undefined && input.visitedAt !== null) {
    if (
      typeof input.visitedAt !== "number" ||
      !Number.isFinite(input.visitedAt) ||
      input.visitedAt > now + 60_000 ||
      input.visitedAt < now - 365 * 86_400_000
    )
      return badRequest("The visit date is not plausible.");
    visitedAt = input.visitedAt;
  }

  let place;
  try {
    place = await getPlaceById(placeId);
  } catch {
    return unavailable();
  }
  if (!place) return notFound("That halal place could not be found.");

  let verification: VerificationResult = MANUAL_VISIT;
  let verificationNote: string | null = null;
  let receiptR2Key: string | null = null;

  const proof = input.locationProof;
  if (proof && typeof proof === "object") {
    const device = proof as { lat?: unknown; lng?: unknown; accuracyMeters?: unknown };
    if (typeof device.lat === "number" && typeof device.lng === "number") {
      const result = verifyByLocation({
        device: {
          lat: device.lat,
          lng: device.lng,
          accuracyMeters:
            typeof device.accuracyMeters === "number" ? device.accuracyMeters : null,
        },
        place: { lat: place.lat, lng: place.lng },
        visitedAt,
        now,
        utcOffsetMinutes:
          typeof input.utcOffsetMinutes === "number" ? input.utcOffsetMinutes : 0,
      });
      if (result.ok) verification = result.result;
      else verificationNote = MANUAL_REASON_COPY[result.reason];
    }
  }

  const receipt = input.receipt;
  if (verification.method === "none" && receipt && typeof receipt === "object") {
    const file = receipt as {
      key?: unknown;
      contentType?: unknown;
      byteSize?: unknown;
      venueNameMatches?: unknown;
      visitDateMatches?: unknown;
    };
    if (!isSafeEvidenceR2Key(file.key))
      return badRequest("That receipt upload is invalid.");
    const result = verifyByReceipt({
      contentType: String(file.contentType ?? ""),
      byteSize: Number(file.byteSize ?? 0),
      declared: {
        venueNameMatches: file.venueNameMatches === true,
        visitDateMatches: file.visitDateMatches === true,
      },
    });
    if (!result.ok) return badRequest(result.error);
    verification = result.result;
    receiptR2Key = file.key as string;
  }

  const disclosure = evaluateDisclosure({
    relationship: checkIn.relationship,
    incentivized: checkIn.incentivized,
  });

  const limited = await spendBudget(
    consumeCheckInLimits,
    outcome.auth,
    "Too many check-ins. Please try again later.",
  );
  if (limited) return limited;

  try {
    const result = await recordVisit({
      userId: outcome.auth.userId,
      placeId,
      visitedAt,
      verification,
      receiptR2Key,
      checkIn,
    });
    return json(
      {
        ...result,
        placeId,
        verificationNote,
        countsTowardsRanking: disclosure.countsTowardsRanking,
        disclosureLabel: disclosure.publicLabel,
      },
      { status: 201 },
    );
  } catch {
    return unavailable();
  }
}

/** Public aggregate and the newest public check-ins for one place. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const placeId = placeIdParam((await context.params).id);
  if (!placeId) return badRequest("Invalid place id.");
  try {
    const [summary, dishes, checkIns] = await Promise.all([
      getCheckInSummary(placeId),
      getDishHighlights(placeId),
      listPublicCheckIns(placeId),
    ]);
    return json(
      { summary, dishes, checkIns },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch {
    return unavailable();
  }
}
