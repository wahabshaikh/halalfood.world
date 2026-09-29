import { canComment, canViewVisit } from "@halalfood/core/feed";
import { uuidParam } from "@halalfood/core/params";
import {
  getVisitAccess,
  getVisitCard,
  listComments,
} from "../../../../src/lib/feed-repository";
import {
  badRequest,
  json,
  notFound,
  optionalUser,
  unavailable,
} from "../../../../src/lib/api";

/**
 * One shared visit with its likes and comments. A private visit, a private
 * account and a blocked pair all read as "not found", so the response never
 * confirms that a hidden visit exists.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const visitId = uuidParam((await context.params).id);
  if (!visitId) return badRequest("Invalid visit id.");
  try {
    const viewerId = await optionalUser(request);
    const access = await getVisitAccess(visitId, viewerId);
    if (!access || !canViewVisit(access.audience)) return notFound("That visit could not be found.");
    const [visit, comments] = await Promise.all([
      getVisitCard(visitId, viewerId),
      listComments(visitId, viewerId, access.ownerId),
    ]);
    if (!visit) return notFound("That visit could not be found.");
    return json({ visit, comments, canComment: canComment(access.audience) });
  } catch {
    return unavailable();
  }
}
