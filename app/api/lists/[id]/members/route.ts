import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { inviteMembers } from "@/lib/lists";
import { consumeRecLimits } from "@/lib/otp-rate-limit";

/** Body `{handles}`: invite people to plan this list together. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const handles = (body as { handles?: unknown } | null)?.handles;
  if (!Array.isArray(handles) || !handles.length || handles.length > 10 || handles.some((h) => typeof h !== "string"))
    return badRequest("Pick up to 10 people.");
  const limited = await spendBudget(consumeRecLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await inviteMembers(id, outcome.auth.userId, handles as string[]);
    return result.ok ? json({ invited: result.value }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
