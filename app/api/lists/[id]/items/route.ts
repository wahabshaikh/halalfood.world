import { INVALID_JSON, badRequest, json, readJson, requireUser, unavailable } from "@/lib/api";
import { reorderItems } from "@/lib/lists";

/** Body `{placeIds}`: the full new order. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const placeIds = (body as { placeIds?: unknown } | null)?.placeIds;
  if (!Array.isArray(placeIds) || placeIds.length > 500 || placeIds.some((value) => typeof value !== "string")) return badRequest("Send the places in order.");
  try {
    const result = await reorderItems(id, outcome.auth.userId, placeIds as string[]);
    return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
