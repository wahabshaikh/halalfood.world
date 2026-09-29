import { canDeleteComment, canViewVisit } from "@halalfood/core/feed";
import { uuidParam } from "@halalfood/core/params";
import {
  deleteComment,
  getComment,
  getVisitAccess,
} from "../../../../../../src/lib/feed-repository";
import { consumePersonalWriteLimits } from "../../../../../../src/lib/otp-rate-limit";
import {
  badRequest,
  forbidden,
  json,
  notFound,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../../src/lib/api";

/** Remove a comment: its author or the owner of the visit can. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  const params = await context.params;
  const visitId = uuidParam(params.id);
  const commentId = uuidParam(params.commentId);
  if (!visitId || !commentId) return badRequest("Invalid id.");
  const outcome = await requireUser(request, `/visit/${visitId}`);
  if (!outcome.ok) return outcome.response;

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const [comment, access] = await Promise.all([
      getComment(commentId),
      getVisitAccess(visitId, outcome.auth.userId),
    ]);
    if (!comment || comment.visitId !== visitId || !access || !canViewVisit(access.audience))
      return notFound("That comment could not be found.");
    if (
      !canDeleteComment({
        viewerId: outcome.auth.userId,
        commentAuthorId: comment.authorId,
        visitOwnerId: access.ownerId,
      })
    )
      return forbidden("You can only remove your own comments, or comments on your own visits.");
    await deleteComment(commentId);
    return json({ deleted: true });
  } catch {
    return unavailable();
  }
}
