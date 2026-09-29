import { isEventId } from "@halalfood/core/events";
import { getGoing, setRsvp } from "../../../../../src/lib/events-repository";
import { consumePersonalWriteLimits } from "../../../../../src/lib/otp-rate-limit";
import { optionalUser } from "../../../../../src/lib/api";
import {
  badRequest,
  json,
  notFound,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";

/**
 * Who is going: the count for everyone, and the people the viewer follows by
 * name. Signed-out visitors get the count only. Never cached, since it depends
 * on who is looking.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const eventId = (await context.params).id;
  if (!isEventId(eventId)) return badRequest("Invalid event id.");
  try {
    const viewerId = await optionalUser(request);
    return json({ signedIn: viewerId !== null, ...(await getGoing(eventId, viewerId)) });
  } catch {
    return unavailable();
  }
}

async function toggle(
  request: Request,
  context: { params: Promise<{ id: string }> },
  going: boolean,
): Promise<Response> {
  const eventId = (await context.params).id;
  if (!isEventId(eventId)) return badRequest("Invalid event id.");
  const outcome = await requireUser(request, `/event/${eventId}`);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await setRsvp(eventId, outcome.auth.userId, going);
    if (result.ok) return json({ signedIn: true, ...result.state });
    return result.reason === "not-found"
      ? notFound("That event could not be found.")
      : badRequest("This event has finished or been cancelled.");
  } catch {
    return unavailable();
  }
}

/** "I'm going". Repeating it changes nothing. */
export function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return toggle(request, context, true);
}

/** Take it back. */
export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return toggle(request, context, false);
}
