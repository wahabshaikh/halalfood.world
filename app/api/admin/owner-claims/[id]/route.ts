import { BODY_TOO_LARGE, INVALID_JSON, badRequest, json, readBoundedJson, requireModerator, unavailable } from "@/lib/api";
import { parseModerateClaimAction } from "@/lib/core/owner-claim";
import { uuidParam } from "@/lib/core/params";
import { moderateOwnerClaim } from "@/lib/owner-claims";

type Context = { params: Promise<{ id: string }> };

/** Body `{action: "approve" | "reject" | "remove" | "restore", reason?}`. Does not change halal facts. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const id = uuidParam((await params).id);
  if (!id) return badRequest("That claim could not be found.");
  const body = await readBoundedJson(request, 8_000);
  if (body === BODY_TOO_LARGE || body === INVALID_JSON || !body || typeof body !== "object") return badRequest("Send a valid JSON object.");
  const action = parseModerateClaimAction((body as { action?: unknown }).action);
  if (!action.ok) return badRequest(action.error);
  const reason = (body as { reason?: unknown }).reason;
  const note = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null;
  try {
    const result = await moderateOwnerClaim(id, outcome.auth.userId, action.value, note);
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
