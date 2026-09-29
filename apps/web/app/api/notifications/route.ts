import { parseNotificationFilter } from "@halalfood/core/notifications";
import { listNotifications } from "../../../src/lib/notifications-repository";
import { json, requireUser, unavailable } from "../../../src/lib/api";

/**
 * The signed-in diner's activity, newest first, optionally one tab of it:
 * `?filter=halal` or `?filter=follows`. It is personal, so it is never cached.
 */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/activity");
  if (!outcome.ok) return outcome.response;
  const filter = parseNotificationFilter(new URL(request.url).searchParams.get("filter"));
  try {
    return json({ filter, items: await listNotifications(outcome.auth.userId, filter) });
  } catch {
    return unavailable();
  }
}
