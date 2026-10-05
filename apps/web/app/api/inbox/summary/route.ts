import { json, optionalUser } from "../../../../src/lib/api";
import { unreadCount } from "../../../../src/lib/inbox";

/** `{unread}` for the bell and the Friends tab dot. Signed out is simply 0. */
export async function GET(request: Request): Promise<Response> {
  try {
    const userId = await optionalUser(request);
    return json({ unread: userId ? await unreadCount(userId) : 0 });
  } catch {
    return json({ unread: 0 });
  }
}
