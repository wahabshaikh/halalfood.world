import { INVALID_JSON, badRequest, json, readJson, requireModerator, unavailable } from "@/lib/api";
import { moderateSponsorship } from "@/lib/sponsorships";

type Context = { params: Promise<{ id: string }> };

/** Body `{action: "remove" | "restore", reason?}`. Billing stays in Whop: refund there if owed. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON || !body || typeof body !== "object") return badRequest("Send a valid JSON object.");
  const { action, reason } = body as { action?: unknown; reason?: unknown };
  if (action !== "remove" && action !== "restore") return badRequest("Choose remove or restore.");
  const note = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null;
  try {
    const result = await moderateSponsorship((await params).id, outcome.auth.userId, action, note);
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
