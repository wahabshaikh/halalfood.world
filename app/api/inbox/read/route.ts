import { INVALID_JSON, badRequest, json, readJson, requireUser, unavailable } from "@/lib/api";
import { markRead } from "@/lib/inbox";

/** Body `{ids?}`: mark those read, or everything when `ids` is missing. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/inbox");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const raw = (body as { ids?: unknown } | null)?.ids;
  if (raw !== undefined && (!Array.isArray(raw) || raw.length > 200 || raw.some((id) => typeof id !== "string")))
    return badRequest("ids must be a list of ids.");
  try {
    await markRead(outcome.auth.userId, (raw as string[] | undefined) ?? null);
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
