import {
  listEvidenceQueue,
  listPendingDuplicates,
  listPendingEdits,
  listReports,
} from "../../../../src/lib/moderation-repository";
import { listPendingPlaceSubmissions } from "../../../../src/lib/place-link-submissions";
import { getModeratorRole } from "../../../../src/lib/preferences-repository";
import {
  forbidden,
  json,
  requireUser,
  unavailable,
} from "../../../../src/lib/api";

/**
 * The moderation console's working set: pending place submissions, evidence
 * prioritised by the explainable score, pending edits, duplicate reports and
 * open abuse reports. Only a moderator or admin reaches this payload.
 */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/admin");
  if (!outcome.ok) return outcome.response;

  try {
    const role = await getModeratorRole(outcome.auth.userId);
    if (!role) return forbidden("This console is for moderators.");

    const [places, evidence, edits, duplicates, reports] = await Promise.all([
      listPendingPlaceSubmissions(),
      listEvidenceQueue(),
      listPendingEdits(),
      listPendingDuplicates(),
      listReports({ status: "open" }),
    ]);
    return json({ role, places, evidence, edits, duplicates, reports });
  } catch {
    return unavailable();
  }
}
