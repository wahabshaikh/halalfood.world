import { normalizeHandle } from "@/lib/core/people";
import { json, notFound, requireUser, spendBudget, unavailable } from "@/lib/api";
import { consumePersonalWriteLimits } from "@/lib/otp-rate-limit";
import { follow, unfollow } from "@/lib/people";

type Context = { params: Promise<{ handle: string }> };

/** Follow someone. Private accounts get a request: `{status: "pending"}`. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const handle = normalizeHandle(decodeURIComponent((await params).handle));
  if (!handle) return notFound("That person could not be found.");
  const outcome = await requireUser(request, `/u/${handle}`);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await follow(outcome.auth.userId, handle);
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ status: result.status });
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const handle = normalizeHandle(decodeURIComponent((await params).handle));
  if (!handle) return notFound("That person could not be found.");
  const outcome = await requireUser(request, `/u/${handle}`);
  if (!outcome.ok) return outcome.response;
  try {
    return (await unfollow(outcome.auth.userId, handle)) ? json({ status: null }) : notFound("That person could not be found.");
  } catch {
    return unavailable();
  }
}
