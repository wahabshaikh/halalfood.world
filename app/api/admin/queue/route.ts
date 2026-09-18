import {
  listEvidenceQueue,
  listPendingDuplicates,
  listPendingEdits,
  listReports,
} from "../../../../src/lib/moderation-repository";
import { getModeratorRole } from "../../../../src/lib/preferences-repository";
import {
  forbidden,
  json,
  requireUser,
  unavailable,
} from "../../../../src/lib/api";

/**
 * The moderation console's working set: evidence prioritised by the
 * explainable score, pending edits, duplicate reports and open abuse reports.
 */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/admin");
  if (!outcome.ok) return outcome.response;

  try {
    const role = await getModeratorRole(outcome.auth.userId);
    if (!role) return forbidden("This console is for moderators.");

    const [evidence, edits, duplicates, reports] = await Promise.all([
      listEvidenceQueue(),
      listPendingEdits(),
      listPendingDuplicates(),
      listReports({ status: "open" }),
    ]);
    return json({ role, evidence, edits, duplicates, reports });
  } catch {
    return unavailable();
  }
}
