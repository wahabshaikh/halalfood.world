import { validateEvent } from "@halalfood/core/events";
import { createEvent, listUpcomingEvents } from "../../../../src/lib/events-repository";
import { writeAudit } from "../../../../src/lib/contributions-repository";
import { getModeratorRole } from "../../../../src/lib/preferences-repository";
import {
  INVALID_JSON,
  badRequest,
  forbidden,
  json,
  readJson,
  requireUser,
  unavailable,
} from "../../../../src/lib/api";

/** Publish a halal food event with its vendors. Moderators only. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/admin");
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateEvent(body);
  if (!validation.ok) return badRequest(validation.error);

  try {
    if (!(await getModeratorRole(outcome.auth.userId)))
      return forbidden("Only moderators can publish events.");
    const result = await createEvent(validation.event, outcome.auth.userId);
    if (!result.ok) return badRequest("A vendor links to a place that is not listed.");
    await writeAudit({
      actorUserId: outcome.auth.userId,
      action: "event.created",
      targetType: "event",
      targetId: result.id,
      reason: validation.event.title,
    }).catch(() => undefined);
    return json({ id: result.id, path: `/event/${result.id}` }, { status: 201 });
  } catch {
    return unavailable();
  }
}

/** Upcoming events for the console, read fresh so a cancel shows at once. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/admin");
  if (!outcome.ok) return outcome.response;
  try {
    if (!(await getModeratorRole(outcome.auth.userId)))
      return forbidden("Only moderators can manage events.");
    return json({ events: await listUpcomingEvents({ limit: 50 }) });
  } catch {
    return unavailable();
  }
}
