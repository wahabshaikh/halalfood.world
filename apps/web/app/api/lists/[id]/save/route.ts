import {
  getListForViewer,
  saveList,
  unsaveList,
} from "../../../../../src/lib/lists-repository";
import { placeIdParam } from "@halalfood/core/params";
import { consumePersonalWriteLimits } from "../../../../../src/lib/otp-rate-limit";
import {
  badRequest,
  json,
  notFound,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../../src/lib/api";

type Context = { params: Promise<{ id: string }> };

/** Save someone else's list. Repeating it changes nothing. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");
  const outcome = await requireUser(request, `/list/${listId}`);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await saveList(listId, outcome.auth.userId);
    if (!result.ok)
      return result.reason === "own"
        ? badRequest("That list is already yours.")
        : notFound("That list could not be found.");
    const access = await getListForViewer(listId, outcome.auth.userId);
    return json({ saved: true, saves: access?.list.saveCount ?? 0 });
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");
  const outcome = await requireUser(request, `/list/${listId}`);
  if (!outcome.ok) return outcome.response;
  try {
    await unsaveList(listId, outcome.auth.userId);
    const access = await getListForViewer(listId, outcome.auth.userId);
    return json({ saved: false, saves: access?.list.saveCount ?? 0 });
  } catch {
    return unavailable();
  }
}
