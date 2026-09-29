import { canComment } from "@halalfood/core/feed";
import { uuidParam } from "@halalfood/core/params";
import { getVisitAccess, setLike } from "../../../../../src/lib/feed-repository";
import { consumePersonalWriteLimits } from "../../../../../src/lib/otp-rate-limit";
import {
  badRequest,
  json,
  notFound,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";

async function toggle(
  request: Request,
  context: { params: Promise<{ id: string }> },
  liked: boolean,
): Promise<Response> {
  const visitId = uuidParam((await context.params).id);
  if (!visitId) return badRequest("Invalid visit id.");
  const outcome = await requireUser(request, `/visit/${visitId}`);
  if (!outcome.ok) return outcome.response;

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const access = await getVisitAccess(visitId, outcome.auth.userId);
    // Anyone who may read a visit may like it, and no one else can tell it exists.
    if (!access || !canComment(access.audience)) return notFound("That visit could not be found.");
    const likes = await setLike(visitId, outcome.auth.userId, liked);
    return json({ liked, likes });
  } catch {
    return unavailable();
  }
}

/** Like a visit. Repeating it changes nothing. */
export function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return toggle(request, context, true);
}

/** Remove your like. */
export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return toggle(request, context, false);
}
