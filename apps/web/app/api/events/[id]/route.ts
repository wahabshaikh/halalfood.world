import { json, notFound, optionalUser, unavailable } from "../../../../src/lib/api";
import { getEvent } from "../../../../src/lib/events";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const event = await getEvent((await params).id, await optionalUser(request));
    return event ? json({ event }) : notFound("That event could not be found.");
  } catch {
    return unavailable();
  }
}
