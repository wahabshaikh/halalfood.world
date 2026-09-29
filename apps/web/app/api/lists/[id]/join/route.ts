import { joinListWithToken } from "../../../../../src/lib/lists-repository";
import { isEditToken } from "@halalfood/core/place-lists";
import { placeIdParam } from "@halalfood/core/params";
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

/** Join a list through its edit link: `{ "token": "…" }`. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const token = (body as { token?: unknown } | null)?.token;
  if (!isEditToken(token)) return notFound("That link is no longer valid.");

  // Signing in must bring the person back to the link, token and all.
  const outcome = await requireUser(request, `/list/${listId}?join=${token}`);
  if (!outcome.ok) return outcome.response;

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const result = await joinListWithToken(listId, outcome.auth.userId, token);
    if (!result.ok) {
      if (result.reason === "owner") return badRequest("This is your own list.");
      if (result.reason === "full") return badRequest("This list has as many collaborators as it can hold.");
      // A wrong token, a turned-off link and a block all look the same.
      return notFound("That link is no longer valid.");
    }
    return json({ joined: true });
  } catch {
    return unavailable();
  }
}
