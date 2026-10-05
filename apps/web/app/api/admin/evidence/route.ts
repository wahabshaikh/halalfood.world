import { json, requireModerator, unavailable } from "../../../../src/lib/api";
import { listPendingEvidence } from "../../../../src/lib/place-evidence";

/** Certificates and menus waiting on review, oldest first. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ evidence: await listPendingEvidence() });
  } catch {
    return unavailable();
  }
}
