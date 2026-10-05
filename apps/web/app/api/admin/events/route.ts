import { INVALID_JSON, badRequest, json, readJson, requireModerator, unavailable } from "../../../../src/lib/api";
import { listAllEvents, parseEventInput, saveEvent } from "../../../../src/lib/events";

export async function GET(request: Request): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ events: await listAllEvents() });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseEventInput(body);
  if (!parsed.ok) return badRequest(parsed.error);
  try {
    const id = await saveEvent(null, parsed.value, outcome.auth.userId);
    return json({ id }, { status: 201 });
  } catch {
    return unavailable();
  }
}
