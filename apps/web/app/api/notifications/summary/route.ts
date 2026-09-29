import { unreadNotificationCount } from "../../../../src/lib/notifications-repository";
import { unreadRecCount } from "../../../../src/lib/recs-repository";
import { json, requireUser, unavailable } from "../../../../src/lib/api";

/** The two numbers on the home header: unread activity and unread recs. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/activity");
  if (!outcome.ok) return outcome.response;
  try {
    const [unread, recs] = await Promise.all([
      unreadNotificationCount(outcome.auth.userId),
      unreadRecCount(outcome.auth.userId),
    ]);
    return json({ unread, recs });
  } catch {
    return unavailable();
  }
}
