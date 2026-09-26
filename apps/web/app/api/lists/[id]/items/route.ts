import {
  getList,
  listItems,
  replaceListItems,
} from "../../../../../src/lib/lists-repository";
import {
  unvisitedRankedEntries,
  validateListItems,
} from "@halalfood/core/place-lists";
import { listVisitedPlaceIds } from "../../../../../src/lib/visits";
import { placeIdParam } from "@halalfood/core/params";
import { consumePersonalWriteLimits } from "../../../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  forbidden,
  json,
  notFound,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";

/**
 * Replace a list's ordered contents.
 *
 * A published ranked list may only contain places the owner has confirmed
 * visiting — that is what makes "my top ten biryani" a personal ranking rather
 * than a repackaged aggregate.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");

  const outcome = await requireUser(request, "/lists");
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON array.");
  const payload = Array.isArray(body) ? body : (body as { items?: unknown }).items;
  const validation = validateListItems(payload);
  if (!validation.ok) return badRequest(validation.error);

  try {
    const list = await getList(listId);
    if (!list) return notFound("That list could not be found.");
    if (list.userId !== outcome.auth.userId)
      return forbidden("That list is not yours to edit.");

    if (list.ranked && list.visibility !== "private") {
      const visited = await listVisitedPlaceIds(outcome.auth.userId);
      const missing = unvisitedRankedEntries(validation.data, visited);
      if (missing.length)
        return badRequest(
          `A published ranked list may only contain places you have recorded a visit to. ${missing.length} ${missing.length === 1 ? "entry has" : "entries have"} no visit yet.`,
        );
    }

    const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
    if (limited) return limited;

    await replaceListItems(listId, validation.data);
    return json({ items: await listItems(listId) });
  } catch {
    return unavailable();
  }
}
