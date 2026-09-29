import { markNotificationsRead } from "../../../../src/lib/notifications-repository";
import { consumePersonalWriteLimits } from "../../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../src/lib/api";

/** Mark notifications read: `{ "all": true }` or `{ "ids": ["..."] }`. */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body === INVALID_JSON || !body || typeof body !== "object" || Array.isArray(body))
    return badRequest("Send a valid JSON object.");
  const { all, ids } = body as { all?: unknown; ids?: unknown };
  let target: "all" | string[];
  if (all === true) target = "all";
  else if (Array.isArray(ids) && ids.length && ids.length <= 200 && ids.every((id) => typeof id === "string" && id.length <= 64))
    target = ids as string[];
  else return badRequest("Send { all: true } or a list of ids.");

  const outcome = await requireUser(request, "/activity");
  if (!outcome.ok) return outcome.response;

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    await markNotificationsRead(outcome.auth.userId, target);
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
