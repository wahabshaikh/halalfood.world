import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { createMemberKey, listMemberKeys, parseKeyFields } from "@/lib/member-keys";
import { consumePersonalWriteLimits } from "@/lib/otp-rate-limit";

/** The signed-in member's active API keys: prefix only, never the key or its hash. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/me/keys");
  if (!outcome.ok) return outcome.response;
  try {
    return json({ keys: await listMemberKeys(outcome.auth.userId) });
  } catch {
    return unavailable();
  }
}

/** Body `{name, scopes?}`. The response carries the key; it is never shown again. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/me/keys");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseKeyFields(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await createMemberKey(outcome.auth.userId, parsed.fields);
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ key: result.key, record: result.record }, { status: 201 });
  } catch {
    return unavailable();
  }
}
