import { validateRec } from "@halalfood/core/recs";
import { getPreferences } from "../../../src/lib/preferences-repository";
import { listRecs, sendRecs } from "../../../src/lib/recs-repository";
import { consumePersonalWriteLimits } from "../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  notFound,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../src/lib/api";

/** Recs sent to the signed-in diner, or `?box=sent` for the ones they sent. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/recs");
  if (!outcome.ok) return outcome.response;
  const box = new URL(request.url).searchParams.get("box") === "sent" ? "sent" : "inbox";
  try {
    const preferences = await getPreferences(outcome.auth.userId);
    return json({ box, ...(await listRecs(outcome.auth.userId, box, preferences)) });
  } catch {
    return unavailable();
  }
}

/**
 * Send a place or a list to friends with an optional note. Recipients must be
 * people you follow or who follow you; anyone else is reported the same way as
 * a missing account.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateRec(body);
  if (!validation.ok) return badRequest(validation.error);

  const outcome = await requireUser(request, "/recs");
  if (!outcome.ok) return outcome.response;

  const limited = await spendBudget(
    consumePersonalWriteLimits,
    outcome.auth,
    "You are sending recs too quickly. Please wait a moment.",
  );
  if (limited) return limited;

  try {
    const result = await sendRecs(outcome.auth.userId, validation.rec);
    if (!result.ok)
      return result.reason === "list-not-shareable"
        ? badRequest("Only a public list can be sent. Make it public first.")
        : notFound("That could not be found.");
    return json({ outcomes: result.outcomes }, { status: 201 });
  } catch {
    return unavailable();
  }
}
