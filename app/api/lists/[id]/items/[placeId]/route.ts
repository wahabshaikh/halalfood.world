import { placeIdParam } from "@/lib/core/params";
import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { addItem, cleanItemNote, removeItem } from "@/lib/lists";
import { consumePersonalWriteLimits } from "@/lib/otp-rate-limit";

type Context = { params: Promise<{ id: string; placeId: string }> };

/** Add a place, with an optional `note`. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { id, placeId: rawPlace } = await params;
  const placeId = placeIdParam(rawPlace);
  if (!placeId) return badRequest("That place id is not valid.");
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  const note = cleanItemNote(body === INVALID_JSON ? null : (body as { note?: unknown } | null)?.note);
  if (!note.ok) return badRequest(note.error);
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await addItem(id, outcome.auth.userId, placeId, note.note);
    return result.ok ? json({ ok: true }, { status: 201 }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { id, placeId: rawPlace } = await params;
  const placeId = placeIdParam(rawPlace);
  if (!placeId) return badRequest("That place id is not valid.");
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  try {
    const result = await removeItem(id, outcome.auth.userId, placeId);
    return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
