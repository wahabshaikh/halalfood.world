import { validatePlaceSubmission } from "@halalfood/core/place-submission";
import { INVALID_JSON, badRequest, json, optionalUser, readJson, requireUser, spendBudget, unavailable } from "../../../src/lib/api";
import { loadExplore, parseExploreParams } from "../../../src/lib/explore";
import { addPlaceFromGoogle } from "../../../src/lib/google-place-submission";
import { consumePlaceSubmissionLimits } from "../../../src/lib/otp-rate-limit";

/** Explore list and map pins (spec §5.1). */
export async function GET(request: Request) {
  let params;
  try {
    params = parseExploreParams(new URL(request.url).searchParams, 300);
  } catch (error) {
    return badRequest((error as Error).message);
  }
  try {
    const viewerId = await optionalUser(request);
    const result = await loadExplore(viewerId, params);
    return Response.json(result, {
      headers: viewerId ? { "Cache-Control": "no-store" } : { "Cache-Control": "public, max-age=30, s-maxage=60" },
    });
  } catch {
    return unavailable("Places are temporarily unavailable. Please try again.");
  }
}

/** Add a place from a Google result; optional answers become check 1. */
export async function POST(request: Request) {
  const outcome = await requireUser(request, "/add");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validatePlaceSubmission(body);
  if (!validation.ok) return badRequest(validation.error);
  const limited = await spendBudget(consumePlaceSubmissionLimits, outcome.auth, "You’ve added a lot of places today. Please try again tomorrow.");
  if (limited) return limited;
  const key =
    typeof (body as { idempotencyKey?: unknown }).idempotencyKey === "string"
      ? String((body as { idempotencyKey: string }).idempotencyKey)
      : crypto.randomUUID().replace(/-/g, "");
  try {
    const result = await addPlaceFromGoogle(outcome.auth.userId, validation.data, key);
    if (!result.ok)
      return json({ error: result.error, ...(result.existingId ? { id: result.existingId } : {}) }, { status: result.status });
    return json({ id: result.id, status: result.status }, { status: 201 });
  } catch {
    return unavailable("Adding places is temporarily unavailable. Please try again.");
  }
}
