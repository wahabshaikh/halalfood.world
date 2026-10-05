import { INVALID_JSON, badRequest, json, notFound, optionalUser, readJson, requireUser, spendBudget, unavailable } from "../../../../../src/lib/api";
import { addComment, cleanComment, listComments } from "../../../../../src/lib/feed";
import { consumeCommentLimits } from "../../../../../src/lib/otp-rate-limit";
import { avatarUrl } from "../../../../../src/lib/profiles";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const id = (await params).id;
  try {
    const comments = await listComments(id, await optionalUser(request));
    if (!comments) return notFound("This visit isn’t available.");
    return json({
      comments: comments.map((comment) => ({
        ...comment,
        author: { ...comment.author, avatarUrl: comment.author.handle ? avatarUrl(comment.author.avatarKey, comment.author.handle) : null },
      })),
    });
  } catch {
    return unavailable();
  }
}

/** Body `{body}`, 500 characters at most. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/visit/${id}`);
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const cleaned = cleanComment((body as { body?: unknown } | null)?.body);
  if (!cleaned.ok) return badRequest(cleaned.error);
  const limited = await spendBudget(consumeCommentLimits, outcome.auth, "You’ve commented a lot today. Please try again tomorrow.");
  if (limited) return limited;
  try {
    const commentId = await addComment(id, outcome.auth.userId, cleaned.body);
    return commentId ? json({ id: commentId }, { status: 201 }) : notFound("This visit isn’t available.");
  } catch {
    return unavailable();
  }
}
