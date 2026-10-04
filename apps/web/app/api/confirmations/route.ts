import { uuidParam } from "@halalfood/core/params";
import type { RequestAuth } from "../../../src/lib/auth-session";
import {
  confirmCommunityTarget,
  type ConfirmationTarget,
} from "../../../src/lib/community-confirmations";
import { database } from "../../../src/db";
import { domainFailure } from "../../../src/lib/domain-error";
import { consumeContributionLimits } from "../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  forbidden,
  json,
  notFound,
  readJson,
  requireUser,
  spendBudget,
} from "../../../src/lib/api";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

const TARGETS = ["verification", "check-in"] as const;

export type ConfirmationDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  consumeLimits?: typeof consumeContributionLimits;
  database?: DatabaseClient;
};

/**
 * Add the viewer's corroboration of someone else's public halal check or
 * check-in. One row per person. A repeat confirm returns the same count.
 */
export async function handleConfirmationPost(
  request: Request,
  dependencies: ConfirmationDependencies = {},
): Promise<Response> {
  const outcome = await requireUser(request, "/confirm", dependencies.getAuth);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const input = body as Record<string, unknown>;
  const targetType = input.targetType;
  if (!(TARGETS as readonly string[]).includes(String(targetType)))
    return badRequest("Confirm a verification or a check-in.");
  const targetId = uuidParam(typeof input.targetId === "string" ? input.targetId : null);
  if (!targetId) return badRequest("Invalid id.");

  const limited = await spendBudget(
    dependencies.consumeLimits ?? consumeContributionLimits,
    outcome.auth,
  );
  if (limited) return limited;

  try {
    const result = await confirmCommunityTarget(
      outcome.auth.userId,
      targetType as ConfirmationTarget,
      targetId,
      dependencies.database,
    );
    if (!result.ok && result.reason === "own")
      return forbidden("You can't confirm your own check.");
    if (!result.ok) return notFound("That check is not public.");
    return json(
      { ok: true, confirmCount: result.confirmCount, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return domainFailure("Saving this confirmation", error);
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleConfirmationPost(request);
}
