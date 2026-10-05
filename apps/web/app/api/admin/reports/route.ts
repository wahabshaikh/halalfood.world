import { json, requireModerator, unavailable } from "../../../../src/lib/api";
import { listOpenReports } from "../../../../src/lib/moderation";

/** The open queue, oldest first. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ reports: await listOpenReports() });
  } catch {
    return unavailable();
  }
}
