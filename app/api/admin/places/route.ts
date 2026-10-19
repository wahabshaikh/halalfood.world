import { json, requireModerator, unavailable } from "@/lib/api";
import { listPendingPlaces } from "@/lib/contributions";

/** Places from New and Restricted members waiting on review, oldest first. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ places: await listPendingPlaces() });
  } catch {
    return unavailable();
  }
}
