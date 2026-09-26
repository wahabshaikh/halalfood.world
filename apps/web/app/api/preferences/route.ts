import {
  getPreferences,
  savePreferences,
} from "../../../src/lib/preferences-repository";
import { validatePreferences } from "@halalfood/core/user-preferences";
import { consumePersonalWriteLimits } from "../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../src/lib/api";

const RETURN_TO = "/preferences";

export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ preferences: await getPreferences(outcome.auth.userId) });
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validatePreferences(body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    await savePreferences(outcome.auth.userId, validation.data);
    return json({ preferences: validation.data });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  return PUT(request);
}
