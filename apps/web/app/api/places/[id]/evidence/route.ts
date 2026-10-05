import { placeIdParam } from "@halalfood/core/params";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";
import { consumeHalalVerificationLimits } from "../../../../../src/lib/otp-rate-limit";
import { submitEvidence, validateEvidence } from "../../../../../src/lib/place-evidence";

/**
 * Send a halal certificate or a menu for review. Upload the photo through
 * `/api/places/[id]/photos` first, then post
 * `{kind: "certificate", photoId, certifier?, expiresOn?}` or
 * `{kind: "menu", photoId, pork?, alcohol?}`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return badRequest("Invalid place id.");
  const outcome = await requireUser(request, `/place/${placeId}`);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const input = validateEvidence(body);
  if (!input.ok) return json({ error: input.error }, { status: input.status });
  const limited = await spendBudget(consumeHalalVerificationLimits, outcome.auth, "Too many submissions. Please try again later.");
  if (limited) return limited;
  try {
    const result = await submitEvidence(outcome.auth.userId, placeId, input.value);
    return result.ok
      ? json({ id: result.value.id, status: "pending" }, { status: 201 })
      : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
