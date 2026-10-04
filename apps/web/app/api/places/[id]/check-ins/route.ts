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
  linkHalalCheck,
  listPublicCheckIns,
  recordVisit,
} from "../../../../../src/lib/visits";
import {
  validateHalalVerificationSubmission,
  type ValidatedHalalVerification,
} from "../../../../../src/lib/halal-verification";
import {
  d1HalalVerificationRepository,
  submitHalalVerification,
} from "../../../../../src/lib/halal-verifications";
import { getOrCreateProfile } from "../../../../../src/lib/preferences-repository";
import { notifyFriendVisit } from "../../../../../src/lib/notifications-repository";
import { getPlaceById } from "../../../../../src/lib/places";
import {
  consumeCheckInLimits,
  consumeHalalVerificationLimits,
} from "../../../../../src/lib/otp-rate-limit";
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
} from "../../../../../src/lib/api";
import { domainFailure } from "../../../../../src/lib/domain-error";

/**
 * The optional halal check that can ride along with a visit. Answers that only
 * say "not sure" or "didn't look" carry no information, so they are dropped
 * instead of rejecting the whole visit.
 */
function halalCheckOf(
  input: Record<string, unknown>,
  checkIn: { relationship: string; incentivized: boolean },
):
  | { kind: "none" }
  | { kind: "invalid"; error: string }
  | { kind: "check"; data: ValidatedHalalVerification } {
  const raw = input.halalCheck;
  if (raw === undefined || raw === null) return { kind: "none" };
  if (typeof raw !== "object" || Array.isArray(raw))
    return { kind: "invalid", error: "The halal check must be an object." };
  const informative = Object.values(raw as Record<string, unknown>).some(
    (value) => typeof value === "string" && value !== "unsure",
  );
  if (!informative) return { kind: "none" };
  // The visit's own disclosure travels with the check, so an owner, a member
  // of staff or a paid creator cannot raise a status by logging a visit.
  const validation = validateHalalVerificationSubmission({
    answers: raw,
    relationship: checkIn.relationship,
    incentivized: checkIn.incentivized,
  });
  if (!validation.ok) return { kind: "invalid", error: validation.error };
  return { kind: "check", data: validation.data };
}

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

  const halalCheck = halalCheckOf(input, checkIn);
  if (halalCheck.kind === "invalid") return badRequest(halalCheck.error);

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
  } catch (error) {
    return domainFailure("This place", error);
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

  let idempotencyKey: string | null = null;
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
    if (typeof input.idempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(input.idempotencyKey))
      return badRequest("The check-in retry key is not valid.");
    idempotencyKey = input.idempotencyKey;
  }

  const limited = await spendBudget(
    consumeCheckInLimits,
    outcome.auth,
    "Too many check-ins. Please try again later.",
  );
  if (limited) return limited;

  if (halalCheck.kind === "check") {
    const halalLimited = await spendBudget(
      consumeHalalVerificationLimits,
      outcome.auth,
      "Too many halal checks. Log the visit without one, or try again later.",
    );
    if (halalLimited) return halalLimited;
  }

  let result;
  try {
    // A shared visit needs a public handle to link from friends' feeds.
    if (checkIn.shareToFeed)
      await getOrCreateProfile(outcome.auth.userId).catch(() => null);
    result = await recordVisit({
      userId: outcome.auth.userId,
      placeId,
      visitedAt,
      verification,
      receiptR2Key,
      checkIn,
      idempotencyKey,
    });
  } catch (error) {
    return domainFailure("Recording this visit", error);
  }

  // Friends who saved this place hear about a shared visit. A failure here
  // does not undo the visit.
  let notification: "sent" | "skipped" | "failed" = "skipped";
  if (checkIn.shareToFeed && !result.deduped) {
    const notified = await notifyFriendVisit({
      visitId: result.visitId,
      actorId: outcome.auth.userId,
      placeId,
    });
    notification = notified ? "sent" : "failed";
  }

  // The visit is already saved, so nothing after this point may fail it. A halal
  // check that cannot be filed is reported back and the diner can resubmit it
  // from the place page.
  let halalCheckState: "submitted" | "not-sent" | "failed" = "not-sent";
  if (halalCheck.kind === "check" && !result.deduped) {
    try {
      const submitted = await submitHalalVerification(
        d1HalalVerificationRepository(),
        outcome.auth.userId,
        placeId,
        halalCheck.data,
      );
      if (submitted.ok) {
        await linkHalalCheck(
          result.visitId,
          outcome.auth.userId,
          submitted.verification.id,
        );
        halalCheckState = "submitted";
      } else halalCheckState = "failed";
    } catch (error) {
      console.error("check-in.halal-check failed", placeId, error);
      halalCheckState = "failed";
    }
  }

  return json(
    {
      ...result,
      placeId,
      verificationNote,
      countsTowardsRanking: disclosure.countsTowardsRanking,
      disclosureLabel: disclosure.publicLabel,
      sharedToFeed: checkIn.shareToFeed,
      deduped: result.deduped,
      notification,
      halalCheck: result.deduped ? "not-sent" : halalCheckState,
    },
    { status: result.deduped ? 200 : 201 },
  );
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
  } catch (error) {
    return domainFailure("Check-ins for this place", error);
  }
}
