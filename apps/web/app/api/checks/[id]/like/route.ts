import { json, notFound, requireUser, spendBudget, unavailable } from "../../../../../src/lib/api";
import { setLike } from "../../../../../src/lib/feed";
import { consumePersonalWriteLimits } from "../../../../../src/lib/otp-rate-limit";

type Context = { params: Promise<{ id: string }> };

async function like(request: Request, { params }: Context, on: boolean): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/visit/${id}`);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await setLike(id, outcome.auth.userId, on);
    return result ? json(result) : notFound("This visit isn’t available.");
  } catch {
    return unavailable();
  }
}

export function PUT(request: Request, context: Context) {
  return like(request, context, true);
}

export function DELETE(request: Request, context: Context) {
  return like(request, context, false);
}
