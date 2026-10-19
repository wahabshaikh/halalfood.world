import { parseVideoReview } from "@/lib/core/videos";
import { uuidParam } from "@/lib/core/params";
import { INVALID_JSON, badRequest, json, readJson, requireModerator, unavailable } from "@/lib/api";
import { reviewVideo, videoDeps } from "@/lib/videos";

/** Body `{userId, decision: "approve" | "reject", reason?}`: one member's picks for this video. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireModerator(request);
  if (!outcome.ok) return outcome.response;
  const id = uuidParam((await params).id);
  if (!id) return badRequest("That video id is not valid.");
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const input = parseVideoReview(body);
  if (!input.ok) return badRequest(input.error);
  try {
    const result = await reviewVideo(outcome.auth.userId, id, input.userId, input.decision, input.reason, await videoDeps(request));
    return result.ok ? json({ ok: true, ...result.value }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
