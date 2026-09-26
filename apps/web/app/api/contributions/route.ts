import { listContributions } from "../../../src/lib/contributions-repository";
import { CONTRIBUTION_STATUS_COPY } from "@halalfood/core/contributions";
import { json, requireUser, unavailable } from "../../../src/lib/api";

/** Every contribution this account has made, with status and reason. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/contributions");
  if (!outcome.ok) return outcome.response;
  try {
    const contributions = await listContributions(outcome.auth.userId);
    return json({
      contributions: contributions.map((row) => ({
        ...row,
        statusLabel:
          CONTRIBUTION_STATUS_COPY[
            row.status as keyof typeof CONTRIBUTION_STATUS_COPY
          ] ?? row.status,
      })),
    });
  } catch {
    return unavailable();
  }
}
