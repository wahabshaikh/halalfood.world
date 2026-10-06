import { json, requireUser, unavailable } from "@/lib/api";
import { listActivity, listRecs } from "@/lib/inbox";
import { avatarUrl } from "@/lib/profiles";

/** `?tab=activity|recs&cursor=`. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/inbox");
  if (!outcome.ok) return outcome.response;
  const params = new URL(request.url).searchParams;
  const cursor = Number(params.get("cursor"));
  const before = Number.isFinite(cursor) && cursor > 0 ? cursor : null;
  try {
    if (params.get("tab") === "recs") {
      const page = await listRecs(outcome.auth.userId, before);
      return json({
        items: page.items.map((item) => ({ ...item, sender: { ...item.sender, avatarUrl: item.sender.handle ? avatarUrl(item.sender.avatarKey, item.sender.handle) : null } })),
        next: page.next,
      });
    }
    const page = await listActivity(outcome.auth.userId, before);
    return json({
      items: page.items.map((item) => ({
        ...item,
        actor: item.actor ? { ...item.actor, avatarUrl: item.actor.handle ? avatarUrl(item.actor.avatarKey, item.actor.handle) : null } : null,
      })),
      next: page.next,
    });
  } catch {
    return unavailable();
  }
}
