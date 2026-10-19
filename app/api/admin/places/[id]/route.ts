import { INVALID_JSON, badRequest, json, readJson, requireModerator, unavailable } from "@/lib/api";
import { placeIdParam } from "@/lib/core/params";
import { reviewPlaceAdd } from "@/lib/contributions";

/** Body `{decision: "approve" | "reject", reason?}`. A rejection needs a reason. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const placeId = placeIdParam((await params).id);
  if (!placeId) return badRequest("That place could not be found.");
  const body = await readJson(request);
  if (body === INVALID_JSON || !body || typeof body !== "object") return badRequest("Send a valid JSON object.");
  const input = body as { decision?: unknown; reason?: unknown };
  if (input.decision !== "approve" && input.decision !== "reject") return badRequest("Approve or reject it.");
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 300) : null;
  if (input.decision === "reject" && !reason) return badRequest("Say why it was rejected.");
  try {
    const result = await reviewPlaceAdd(placeId, outcome.auth.userId, input.decision, reason);
    return result.ok ? json({ ok: true, points: result.points }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
