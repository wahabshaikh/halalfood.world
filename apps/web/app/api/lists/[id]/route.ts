import { INVALID_JSON, badRequest, json, notFound, optionalUser, readJson, requireUser, unavailable } from "../../../../src/lib/api";
import { deleteList, getList, parseListFields, updateList } from "../../../../src/lib/lists";
import { isModerator } from "../../../../src/lib/moderators";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  try {
    const list = await getList((await params).id, await optionalUser(request));
    return list ? json({ list }) : notFound("That list could not be found.");
  } catch {
    return unavailable();
  }
}

/** Edit title, caption or visibility (owner only). */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseListFields(body, false);
  if (!parsed.ok) return badRequest(parsed.error);
  try {
    const result = await updateList(id, outcome.auth.userId, parsed.fields);
    return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  try {
    const result = await deleteList(id, outcome.auth.userId, await isModerator(outcome.auth.userId));
    return result.ok ? json({ deleted: true }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
