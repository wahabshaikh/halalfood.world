import { validateRec } from "@halalfood/core/recs";
import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "../../../src/lib/api";
import { sendRecs } from "../../../src/lib/inbox";
import { consumeRecLimits } from "../../../src/lib/otp-rate-limit";

/** Body `{to: handle[], placeId | listId | eventId, note?}`. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/inbox?tab=recs");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateRec(body);
  if (!validation.ok) return badRequest(validation.error);
  const limited = await spendBudget(consumeRecLimits, outcome.auth, "You’ve sent a lot today. Please try again tomorrow.");
  if (limited) return limited;
  try {
    const result = await sendRecs(outcome.auth.userId, validation.rec);
    if (!result.sent) return json({ error: "You can send to people you follow or who follow you.", ...result }, { status: 422 });
    return json(result, { status: 201 });
  } catch {
    return unavailable();
  }
}
