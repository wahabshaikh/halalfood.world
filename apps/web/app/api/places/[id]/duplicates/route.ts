import { placeIdParam } from "@halalfood/core/params";
import { validateDuplicateReport } from "@halalfood/core/contributions";
import { submitDuplicateReport } from "../../../../../src/lib/contributions-repository";
import { consumeContributionLimits } from "../../../../../src/lib/otp-rate-limit";
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

/** Report that this place duplicates another. A moderator performs the merge. */
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
  const validation = validateDuplicateReport(placeId, body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumeContributionLimits, outcome.auth);
  if (limited) return limited;

  try {
    const result = await submitDuplicateReport(
      placeId,
      validation.data.duplicateOfPlaceId,
      outcome.auth.userId,
      validation.data.note,
    );
    if (!result.ok) return notFound("One of those places could not be found.");
    return json({ id: result.id, status: "pending" }, { status: 201 });
  } catch {
    return unavailable();
  }
}
