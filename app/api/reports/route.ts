import { validateReport } from "../../../src/lib/moderation";
import { createReport, listReports } from "../../../src/lib/moderation-repository";
import { consumeContributionLimits } from "../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../src/lib/api";

/** The reports this account has filed, with their outcomes and appeal state. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/reports");
  if (!outcome.ok) return outcome.response;
  try {
    return json({
      reports: await listReports({ reportedByUserId: outcome.auth.userId }),
    });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/reports");
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateReport(body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumeContributionLimits, outcome.auth);
  if (limited) return limited;

  try {
    const id = await createReport(validation.data, outcome.auth.userId);
    return json({ id, status: "open" }, { status: 201 });
  } catch {
    return unavailable();
  }
}
