import { BODY_TOO_LARGE, INVALID_JSON, badRequest, json, readBoundedJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { uuidParam } from "@/lib/core/params";
import { parseOwnerDetails } from "@/lib/core/owner-claim";
import { saveOwnerDetails } from "@/lib/owner-claims";
import { consumePersonalWriteLimits } from "@/lib/otp-rate-limit";

type Context = { params: Promise<{ id: string }> };

/** Replace the restaurant's phone, website and description. Only the paid claim's owner. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const outcome = await requireUser(request, "/claim");
  if (!outcome.ok) return outcome.response;
  const id = uuidParam((await params).id);
  if (!id) return badRequest("That claim could not be found.");
  const body = await readBoundedJson(request, 8_000);
  if (body === BODY_TOO_LARGE) return badRequest("That is too large.");
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseOwnerDetails(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const saved = await saveOwnerDetails(id, outcome.auth.userId, parsed.value);
    if (!saved.ok) return json({ error: saved.error }, { status: saved.status });
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
