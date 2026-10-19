import { INVALID_JSON, badRequest, json, readJson, requireModerator, spendBudget, unavailable } from "@/lib/api";
import { parseFlagReview } from "@/lib/core/contribution-flags";
import { uuidParam } from "@/lib/core/params";
import { consumePersonalWriteLimits } from "@/lib/otp-rate-limit";
import { reviewFlag } from "@/lib/contribution-flags";

/** Review a suspicious contribution snapshot with a reason. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const id = uuidParam((await params).id);
  if (!id) return badRequest("That flag id is not valid.");
  const body = await readJson(request);
  const parsed = parseFlagReview(body === INVALID_JSON ? null : body);
  if (!parsed.ok) return badRequest(parsed.error);
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await reviewFlag(id, outcome.auth.userId, parsed.value);
    return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
