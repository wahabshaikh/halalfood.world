import { normalizeHandle } from "@/lib/core/people";
import { json, notFound, requireUser, unavailable } from "@/lib/api";
import { answerRequest } from "@/lib/people";

type Context = { params: Promise<{ handle: string }> };

async function answer(request: Request, { params }: Context, accept: boolean): Promise<Response> {
  const handle = normalizeHandle(decodeURIComponent((await params).handle));
  if (!handle) return notFound("That request could not be found.");
  const outcome = await requireUser(request, "/me/privacy");
  if (!outcome.ok) return outcome.response;
  try {
    return (await answerRequest(outcome.auth.userId, handle, accept))
      ? json({ accepted: accept })
      : notFound("That request could not be found.");
  } catch {
    return unavailable();
  }
}

/** Accept a follow request. */
export function POST(request: Request, context: Context) {
  return answer(request, context, true);
}

/** Decline a follow request. */
export function DELETE(request: Request, context: Context) {
  return answer(request, context, false);
}
