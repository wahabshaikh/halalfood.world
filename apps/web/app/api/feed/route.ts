import { json, requireUser, unavailable } from "../../../src/lib/api";
import { feedPage } from "../../../src/lib/feed";
import { visitJson } from "../../../src/lib/visit-json";

/** Shared checks from people you follow, newest first, 20 per page. `cursor` is the last item's time. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/friends");
  if (!outcome.ok) return outcome.response;
  const cursor = Number(new URL(request.url).searchParams.get("cursor"));
  try {
    const page = await feedPage(outcome.auth.userId, Number.isFinite(cursor) && cursor > 0 ? cursor : null);
    return json({ items: page.items.map(visitJson), next: page.next });
  } catch {
    return unavailable();
  }
}
