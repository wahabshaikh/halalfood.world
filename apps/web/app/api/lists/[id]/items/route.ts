import {
  addListItem,
  getList,
  getListForViewer,
  listItems,
  replaceListItems,
} from "../../../../../src/lib/lists-repository";
import {
  canEditItems,
  unvisitedRankedEntries,
  validateListItem,
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

    await replaceListItems(listId, validation.data, undefined, outcome.auth.userId);
    return json({ items: await listItems(listId) });
  } catch {
    return unavailable();
  }
}

/**
 * Add one place to the end of a list. The owner and accepted collaborators may;
 * on a ranked list only the owner can, and only places they have visited.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");

  const outcome = await requireUser(request, `/list/${listId}`);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateListItem(body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const access = await getListForViewer(listId, outcome.auth.userId);
    if (!access) return notFound("That list could not be found.");
    if (!canEditItems(access.role))
      return forbidden("Only the owner and collaborators can add places.");

    if (access.list.ranked && access.list.visibility !== "private") {
      const visited = await listVisitedPlaceIds(outcome.auth.userId);
      if (!visited.has(validation.placeId))
        return badRequest(
          "A published ranked list may only contain places you have recorded a visit to.",
        );
    }

    const result = await addListItem(listId, validation.placeId, validation.note, outcome.auth.userId);
    if (result === "not-found") return notFound("That halal place could not be found.");
    if (result === "exists") return badRequest("That place is already on the list.");
    if (result === "full") return badRequest("This list is full.");
    return json({ items: await listItems(listId) }, { status: 201 });
  } catch {
    return unavailable();
  }
}
