import {
  findUserIdByHandle,
  followUser,
  getRelation,
  unfollowUser,
} from "../../../../src/lib/social-repository";
import { isValidHandle } from "../../../../src/lib/preferences-repository";
import { consumePersonalWriteLimits } from "../../../../src/lib/otp-rate-limit";
import {
  badRequest,
  forbidden,
  json,
  notFound,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../src/lib/api";

type Context = { params: Promise<{ handle: string }> };

async function target(context: Context): Promise<string | Response> {
  const handle = (await context.params).handle.toLowerCase();
  if (!isValidHandle(handle)) return badRequest("That is not a valid handle.");
  const userId = await findUserIdByHandle(handle);
  return userId ?? notFound("No diner has that handle.");
}

/** How the signed-in diner relates to this handle: following, blocking, blocked by. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const outcome = await requireUser(request, "/feed");
  if (!outcome.ok) return outcome.response;
  try {
    const targetId = await target(context);
    if (targetId instanceof Response) return targetId;
    return json({
      relation: await getRelation(outcome.auth.userId, targetId),
      isSelf: targetId === outcome.auth.userId,
    });
  } catch {
    return unavailable();
  }
}

/** Follow a diner. A block in either direction refuses it. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const outcome = await requireUser(request, "/feed");
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const targetId = await target(context);
    if (targetId instanceof Response) return targetId;
    const result = await followUser(outcome.auth.userId, targetId);
    if (!result.ok)
      return result.reason === "self"
        ? badRequest("You can't follow yourself.")
        : // Do not say who blocked whom.
          forbidden("You can't follow this diner.");
    return json({ relation: await getRelation(outcome.auth.userId, targetId) });
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const outcome = await requireUser(request, "/feed");
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const targetId = await target(context);
    if (targetId instanceof Response) return targetId;
    await unfollowUser(outcome.auth.userId, targetId);
    return json({ relation: await getRelation(outcome.auth.userId, targetId) });
  } catch {
    return unavailable();
  }
}
