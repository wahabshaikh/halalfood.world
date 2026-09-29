import {
  blockUser,
  findUserIdByHandle,
  getRelation,
  unblockUser,
} from "../../../../src/lib/social-repository";
import { isValidHandle } from "../../../../src/lib/preferences-repository";
import { consumePersonalWriteLimits } from "../../../../src/lib/otp-rate-limit";
import {
  badRequest,
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

/**
 * Block a diner. Their visits, likes and comments disappear from your view and
 * yours from theirs, and any follow between you is removed.
 */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const outcome = await requireUser(request, "/feed");
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const targetId = await target(context);
    if (targetId instanceof Response) return targetId;
    const result = await blockUser(outcome.auth.userId, targetId);
    if (!result.ok) return badRequest("You can't block yourself.");
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
    await unblockUser(outcome.auth.userId, targetId);
    return json({ relation: await getRelation(outcome.auth.userId, targetId) });
  } catch {
    return unavailable();
  }
}
