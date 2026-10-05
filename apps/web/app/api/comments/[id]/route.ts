import { forbidden, json, notFound, requireUser, unavailable } from "../../../../src/lib/api";
import { deleteComment } from "../../../../src/lib/feed";
import { isModerator } from "../../../../src/lib/moderators";

/** Delete your own comment, or anything as a moderator. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const outcome = await requireUser(request, "/friends");
  if (!outcome.ok) return outcome.response;
  try {
    const result = await deleteComment((await params).id, outcome.auth.userId, await isModerator(outcome.auth.userId));
    if (result === "missing") return notFound("That comment is gone.");
    if (result === "forbidden") return forbidden();
    return json({ deleted: true });
  } catch {
    return unavailable();
  }
}
