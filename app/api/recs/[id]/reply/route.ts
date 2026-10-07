import { validateRecReply } from "@/lib/core/recs";
import { INVALID_JSON, badRequest, json, notFound, readJson, requireUser, unavailable } from "@/lib/api";
import { replyRec } from "@/lib/inbox";

/** Body `{reply: "in" | "want-to-try"}`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireUser(request, "/inbox?tab=recs");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateRecReply(body);
  if (!validation.ok) return badRequest(validation.error);
  try {
    return (await replyRec(outcome.auth.userId, (await params).id, validation.reply))
      ? json({ reply: validation.reply })
      : notFound("That rec is gone.");
  } catch {
    return unavailable();
  }
}
