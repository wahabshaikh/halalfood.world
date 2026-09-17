import { placeIdParam } from "../../../../../src/lib/params";
import { validateDish } from "../../../../../src/lib/contributions";
import { createDish, listDishes } from "../../../../../src/lib/dishes-repository";
import { consumeContributionLimits } from "../../../../../src/lib/otp-rate-limit";
import { writeAudit } from "../../../../../src/lib/contributions-repository";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const placeId = placeIdParam((await context.params).id);
  if (!placeId) return badRequest("Invalid place id.");
  try {
    return json(
      { dishes: await listDishes(placeId) },
      { headers: { "Cache-Control": "public, max-age=120" } },
    );
  } catch {
    return unavailable();
  }
}

/** Contribute a missing dish. A cited source publishes it; without one it queues. */
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
  const validation = validateDish(body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumeContributionLimits, outcome.auth);
  if (limited) return limited;

  try {
    const result = await createDish(placeId, outcome.auth.userId, validation.data);
    if (!result.ok) return badRequest("That dish is already listed here.");
    await writeAudit({
      actorUserId: outcome.auth.userId,
      action: "dish.added",
      targetType: "dish",
      targetId: result.id,
      source: validation.data.sourceUrl,
      after: { name: validation.data.name, status: result.status },
    });
    return json({ id: result.id, status: result.status }, { status: 201 });
  } catch {
    return unavailable();
  }
}
