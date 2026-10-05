import { json, notFound, requireUser, spendBudget, unavailable } from "../../../../../src/lib/api";
import { setGoing } from "../../../../../src/lib/events";
import { consumePersonalWriteLimits } from "../../../../../src/lib/otp-rate-limit";

type Context = { params: Promise<{ id: string }> };

async function going(request: Request, { params }: Context, on: boolean): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/event/${id}`);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await setGoing(id, outcome.auth.userId, on);
    return result ? json(result) : notFound("That event could not be found.");
  } catch {
    return unavailable();
  }
}

export function PUT(request: Request, context: Context) {
  return going(request, context, true);
}

export function DELETE(request: Request, context: Context) {
  return going(request, context, false);
}
