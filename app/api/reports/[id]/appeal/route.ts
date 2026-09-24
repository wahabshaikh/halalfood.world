import { validateAppeal } from "../../../../../src/lib/moderation";
import { createAppeal } from "../../../../../src/lib/moderation-repository";
import { placeIdParam } from "../../../../../src/lib/params";
import { consumeContributionLimits } from "../../../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";

/** Appeal a decided report. Every consequential decision has this path. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const reportId = placeIdParam((await context.params).id);
  if (!reportId) return badRequest("Invalid report id.");

  const outcome = await requireUser(request, "/reports");
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateAppeal(body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumeContributionLimits, outcome.auth);
  if (limited) return limited;

  try {
    const result = await createAppeal(
      reportId,
      outcome.auth.userId,
      validation.data.reason,
    );
    if (!result.ok)
      return badRequest("That report has not been decided yet, so it cannot be appealed.");
    return json({ id: result.id, status: "open" }, { status: 201 });
  } catch {
    return unavailable();
  }
}
