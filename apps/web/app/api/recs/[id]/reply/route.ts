import { validateRecReply } from "@halalfood/core/recs";
import { uuidParam } from "@halalfood/core/params";
import { replyToRec } from "../../../../../src/lib/recs-repository";
import { consumePersonalWriteLimits } from "../../../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  notFound,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";

/** Answer a rec with `{ "reply": "in" | "want-to-try" }`. There is no free text. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const recId = uuidParam((await context.params).id);
  if (!recId) return badRequest("Invalid rec id.");
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateRecReply(body);
  if (!validation.ok) return badRequest(validation.error);

  const outcome = await requireUser(request, "/recs");
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const result = await replyToRec(recId, outcome.auth.userId, validation.reply);
    return result.ok ? json({ reply: result.reply }) : notFound("That rec could not be found.");
  } catch {
    return unavailable();
  }
}
