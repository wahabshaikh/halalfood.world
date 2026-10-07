import { normalizeHandle } from "@/lib/core/people";
import { json, notFound, requireUser, spendBudget, unavailable } from "@/lib/api";
import { consumePersonalWriteLimits } from "@/lib/otp-rate-limit";
import { block, unblock } from "@/lib/people";

type Context = { params: Promise<{ handle: string }> };

/** Block someone: removes follows both ways and hides each side from the other. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const handle = normalizeHandle(decodeURIComponent((await params).handle));
  if (!handle) return notFound("That person could not be found.");
  const outcome = await requireUser(request, `/u/${handle}`);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    return (await block(outcome.auth.userId, handle)) ? json({ blocked: true }) : notFound("That person could not be found.");
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const handle = normalizeHandle(decodeURIComponent((await params).handle));
  if (!handle) return notFound("That person could not be found.");
  const outcome = await requireUser(request, "/me/privacy");
  if (!outcome.ok) return outcome.response;
  try {
    return (await unblock(outcome.auth.userId, handle)) ? json({ blocked: false }) : notFound("That person could not be found.");
  } catch {
    return unavailable();
  }
}
