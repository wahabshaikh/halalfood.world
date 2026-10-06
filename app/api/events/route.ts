import { citySlugParam } from "@/lib/core/params";
import { json, optionalUser, unavailable } from "@/lib/api";
import { listEvents } from "@/lib/events";

/** `?city=`: upcoming published events, soonest first. */
export async function GET(request: Request): Promise<Response> {
  const city = citySlugParam(new URL(request.url).searchParams.get("city"));
  try {
    return json({ events: await listEvents({ citySlug: city, viewerId: await optionalUser(request) }) });
  } catch {
    return unavailable();
  }
}
