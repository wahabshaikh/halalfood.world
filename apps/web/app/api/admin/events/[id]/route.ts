import { INVALID_JSON, badRequest, json, notFound, readJson, requireModerator, unavailable } from "../../../../../src/lib/api";
import { deleteEvent, getEvent, parseEventInput, saveEvent } from "../../../../../src/lib/events";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  try {
    const event = await getEvent((await params).id, outcome.auth.userId, { moderator: true });
    return event ? json({ event }) : notFound("That event could not be found.");
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseEventInput(body);
  if (!parsed.ok) return badRequest(parsed.error);
  try {
    const id = await saveEvent((await params).id, parsed.value, outcome.auth.userId);
    return id ? json({ id }) : notFound("That event could not be found.");
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  try {
    await deleteEvent((await params).id);
    return json({ deleted: true });
  } catch {
    return unavailable();
  }
}
