import { json, requireModerator, unavailable } from "@/lib/api";
import { listPendingChanges } from "@/lib/certifiers/repository";

/** Changes to official certifier lists waiting on review, oldest first. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ changes: await listPendingChanges() });
  } catch {
    return unavailable();
  }
}
