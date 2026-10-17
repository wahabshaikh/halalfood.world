import { INVALID_JSON, badRequest, json, readJson, requireModerator, unavailable } from "@/lib/api";
import { reviewChange } from "@/lib/certifiers/repository";

/** Body `{decision: "approve" | "reject"}`. Approving publishes the change to the directory. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON || !body || typeof body !== "object") return badRequest("Send a valid JSON object.");
  const decision = (body as { decision?: unknown }).decision;
  if (decision !== "approve" && decision !== "reject") return badRequest("Approve or reject it.");
  const id = (await params).id;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return badRequest("Invalid change id.");
  try {
    const result = await reviewChange(id, outcome.auth.userId, decision);
    return result.ok ? json({ ok: true, state: result.state }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
