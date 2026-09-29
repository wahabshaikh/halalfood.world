import { searchLists } from "../../../../src/lib/lists-repository";
import { json, optionalUser, unavailable } from "../../../../src/lib/api";

/** Public lists by title, caption or owner. Without a query, the most saved. */
export async function GET(request: Request): Promise<Response> {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 64);
  if (q && q.length < 2) return json({ lists: [] });
  try {
    const viewerId = await optionalUser(request);
    return json({ lists: await searchLists(q, viewerId) });
  } catch {
    return unavailable();
  }
}
