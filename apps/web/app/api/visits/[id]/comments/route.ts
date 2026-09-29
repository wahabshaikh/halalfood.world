import { canComment, validateComment } from "@halalfood/core/feed";
import { dedupeKeys } from "@halalfood/core/notifications";
import { uuidParam } from "@halalfood/core/params";
import {
  addComment,
  getVisitAccess,
} from "../../../../../src/lib/feed-repository";
import { tryNotify } from "../../../../../src/lib/notifications-repository";
import { consumeCommentLimits } from "../../../../../src/lib/otp-rate-limit";
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

/** Add a comment. Comments are plain text, and reportable like any contribution. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const visitId = uuidParam((await context.params).id);
  if (!visitId) return badRequest("Invalid visit id.");
  const outcome = await requireUser(request, `/visit/${visitId}`);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateComment(body);
  if (!validation.ok) return badRequest(validation.error);

  try {
    const access = await getVisitAccess(visitId, outcome.auth.userId);
    if (!access || !canComment(access.audience)) return notFound("That visit could not be found.");

    const limited = await spendBudget(
      consumeCommentLimits,
      outcome.auth,
      "You are commenting too quickly. Please wait a moment.",
    );
    if (limited) return limited;

    const comment = await addComment(
      visitId,
      outcome.auth.userId,
      validation.body,
      access.ownerId,
    );
    await tryNotify({
      userId: access.ownerId,
      kind: "comment",
      actorId: outcome.auth.userId,
      visitId,
      placeId: access.placeId,
      dedupeKey: dedupeKeys.comment(comment.id),
    });
    return json({ comment }, { status: 201 });
  } catch {
    return unavailable();
  }
}
