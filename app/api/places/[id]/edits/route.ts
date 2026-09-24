import { placeIdParam } from "../../../../../src/lib/params";
import {
  CONTRIBUTION_STATUS_COPY,
  validateEditSuggestion,
} from "../../../../../src/lib/contributions";
import { submitEditSuggestion } from "../../../../../src/lib/contributions-repository";
import { consumeContributionLimits } from "../../../../../src/lib/otp-rate-limit";
import { getPlaceById } from "../../../../../src/lib/places";
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
 * Suggest a factual correction. Low-risk edits from reliable contributors apply
 * immediately; halal-sensitive ones always queue, and the response says which
 * happened and why.
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
  const validation = validateEditSuggestion(body);
  if (!validation.ok) return badRequest(validation.error);

  try {
    if (!(await getPlaceById(placeId)))
      return notFound("That halal place could not be found.");
  } catch {
    return unavailable();
  }

  const limited = await spendBudget(consumeContributionLimits, outcome.auth);
  if (limited) return limited;

  try {
    const result = await submitEditSuggestion(
      placeId,
      outcome.auth.userId,
      validation.data,
    );
    return json(
      {
        ...result,
        statusLabel: CONTRIBUTION_STATUS_COPY[result.status],
      },
      { status: 201 },
    );
  } catch {
    return unavailable();
  }
}
