import { placeIdParam } from "@/lib/core/params";
import { INVALID_JSON, badRequest, json, readJson, requireModerator, unavailable } from "@/lib/api";
import { ACTIONS, actOnReport, type Action } from "@/lib/moderation";

/** Body `{action, intoPlaceId?, details?}`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON || !body || typeof body !== "object") return badRequest("Send a valid JSON object.");
  const input = body as { action?: unknown; intoPlaceId?: unknown; details?: unknown };
  if (!ACTIONS.includes(input.action as Action)) return badRequest("Unknown action.");
  const intoPlaceId = input.intoPlaceId ? placeIdParam(String(input.intoPlaceId)) : undefined;
  if (input.intoPlaceId && !intoPlaceId) return badRequest("That place id is not valid.");
  try {
    const result = await actOnReport((await params).id, outcome.auth.userId, {
      action: input.action as Action,
      intoPlaceId: intoPlaceId ?? undefined,
      details: input.details && typeof input.details === "object" ? (input.details as Record<string, string>) : undefined,
    });
    return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
