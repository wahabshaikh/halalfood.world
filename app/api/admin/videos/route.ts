import { json, requireModerator, unavailable } from "@/lib/api";
import { listVideoQueue } from "@/lib/videos";

/** Video picks from New-tier members waiting on review, oldest first. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ videos: await listVideoQueue() });
  } catch {
    return unavailable();
  }
}
