import { INVALID_JSON, badRequest, json, readJson, requireModerator, unavailable } from "../../../../../src/lib/api";
import { reviewEvidence } from "../../../../../src/lib/place-evidence";

/** Body `{decision: "approve" | "reject", reason?}`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON || !body || typeof body !== "object") return badRequest("Send a valid JSON object.");
  const input = body as { decision?: unknown; reason?: unknown };
  if (input.decision !== "approve" && input.decision !== "reject") return badRequest("Approve or reject it.");
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 300) : null;
  try {
    const result = await reviewEvidence((await params).id, outcome.auth.userId, input.decision, reason);
    return result.ok
      ? json({ ok: true, status: result.value.recompute.after })
      : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
