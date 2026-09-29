import { HANDLE_PATTERN, normalizeHandle } from "@halalfood/core/social";
import { consumePersonalWriteLimits } from "../../../../src/lib/otp-rate-limit";
import { followUser, unfollowUser } from "../../../../src/lib/social-repository";
import {
  badRequest,
  json,
  notFound,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../src/lib/api";

function handleOf(raw: string): string | null {
  const handle = normalizeHandle(decodeURIComponent(raw));
  return handle && HANDLE_PATTERN.test(handle) ? handle : null;
}

/** Follow a diner, or ask to follow when their account is private. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = handleOf((await params).handle);
  if (!handle) return badRequest("That is not a valid handle.");
  const outcome = await requireUser(request, `/u/${handle}`);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const result = await followUser(outcome.auth.userId, handle);
    if (!result.ok)
      return result.reason === "self"
        ? badRequest("You cannot follow yourself.")
        : notFound("That diner could not be found.");
    return json({ handle, status: result.status });
  } catch {
    return unavailable();
  }
}

/** Unfollow, or withdraw a follow request. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = handleOf((await params).handle);
  if (!handle) return badRequest("That is not a valid handle.");
  const outcome = await requireUser(request, `/u/${handle}`);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    await unfollowUser(outcome.auth.userId, handle);
    return json({ handle, status: null });
  } catch {
    return unavailable();
  }
}
