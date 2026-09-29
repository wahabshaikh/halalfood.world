import { HANDLE_PATTERN, normalizeHandle } from "@halalfood/core/social";
import { consumePersonalWriteLimits } from "../../../../src/lib/otp-rate-limit";
import { respondToFollowRequest } from "../../../../src/lib/social-repository";
import {
  INVALID_JSON,
  badRequest,
  json,
  notFound,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../src/lib/api";

/** Accept or decline a follow request: `{ "accept": true | false }`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle(decodeURIComponent((await params).handle));
  if (!handle || !HANDLE_PATTERN.test(handle))
    return badRequest("That is not a valid handle.");
  const body = await readJson(request);
  if (body === INVALID_JSON || typeof (body as { accept?: unknown })?.accept !== "boolean")
    return badRequest("Send { accept: true } or { accept: false }.");

  const outcome = await requireUser(request, "/settings");
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const done = await respondToFollowRequest(
      outcome.auth.userId,
      handle,
      (body as { accept: boolean }).accept,
    );
    if (!done) return notFound("There is no pending request from that diner.");
    return json({ handle, accepted: (body as { accept: boolean }).accept });
  } catch {
    return unavailable();
  }
}
