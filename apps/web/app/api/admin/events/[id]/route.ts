import { isEventId, validateEvent } from "@halalfood/core/events";
import { setEventCancelled, updateEvent } from "../../../../../src/lib/events-repository";
import { writeAudit } from "../../../../../src/lib/contributions-repository";
import { getModeratorRole } from "../../../../../src/lib/preferences-repository";
import {
  INVALID_JSON,
  badRequest,
  forbidden,
  json,
  notFound,
  readJson,
  requireUser,
  unavailable,
} from "../../../../../src/lib/api";

async function moderator(
  request: Request,
): Promise<{ response: Response } | { userId: string }> {
  const outcome = await requireUser(request, "/admin");
  if (!outcome.ok) return { response: outcome.response };
  if (!(await getModeratorRole(outcome.auth.userId)))
    return { response: forbidden("Only moderators can change events.") };
  return { userId: outcome.auth.userId };
}

/** Replace an event's details and vendors. RSVPs stay. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const eventId = (await context.params).id;
  if (!isEventId(eventId)) return badRequest("Invalid event id.");
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateEvent(body);
  if (!validation.ok) return badRequest(validation.error);
  try {
    const who = await moderator(request);
    if ("response" in who) return who.response;
    const result = await updateEvent(eventId, validation.event);
    if (!result.ok)
      return result.reason === "not-found"
        ? notFound("That event could not be found.")
        : badRequest("A vendor links to a place that is not listed.");
    await writeAudit({
      actorUserId: who.userId,
      action: "event.updated",
      targetType: "event",
      targetId: eventId,
      reason: validation.event.title,
    }).catch(() => undefined);
    return json({ id: eventId, path: `/event/${eventId}` });
  } catch {
    return unavailable();
  }
}

/** Cancel an event, or `?restore=1` to bring it back. It stays reachable by its link. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const eventId = (await context.params).id;
  if (!isEventId(eventId)) return badRequest("Invalid event id.");
  const restore = new URL(request.url).searchParams.get("restore") === "1";
  try {
    const who = await moderator(request);
    if ("response" in who) return who.response;
    if (!(await setEventCancelled(eventId, !restore)))
      return notFound("That event could not be found.");
    await writeAudit({
      actorUserId: who.userId,
      action: restore ? "event.restored" : "event.cancelled",
      targetType: "event",
      targetId: eventId,
      reason: null,
    }).catch(() => undefined);
    return json({ id: eventId, cancelled: !restore });
  } catch {
    return unavailable();
  }
}
