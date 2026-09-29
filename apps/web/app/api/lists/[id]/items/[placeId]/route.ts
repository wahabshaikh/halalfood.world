import {
  changeListItem,
  getListForViewer,
  listItems,
} from "../../../../../../src/lib/lists-repository";
import { canEditItems } from "@halalfood/core/place-lists";
import { placeIdParam } from "@halalfood/core/params";
import { consumePersonalWriteLimits } from "../../../../../../src/lib/otp-rate-limit";
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
} from "../../../../../../src/lib/api";

type Context = { params: Promise<{ id: string; placeId: string }> };

async function change(
  request: Request,
  context: Context,
  build: (body: unknown) => { remove: true } | { note: string | null } | string,
): Promise<Response> {
  const params = await context.params;
  const listId = placeIdParam(params.id);
  const placeId = placeIdParam(params.placeId);
  if (!listId || !placeId) return badRequest("Invalid id.");

  const outcome = await requireUser(request, `/list/${listId}`);
  if (!outcome.ok) return outcome.response;

  let body: unknown = null;
  if (request.method !== "DELETE") {
    body = await readJson(request);
    if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  }
  const change = build(body);
  if (typeof change === "string") return badRequest(change);

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const access = await getListForViewer(listId, outcome.auth.userId);
    if (!access) return notFound("That list could not be found.");
    if (!canEditItems(access.role))
      return forbidden("Only the owner and collaborators can change places.");
    const changed = await changeListItem(
      listId,
      placeId,
      { userId: outcome.auth.userId, role: access.role as "owner" | "editor" },
      change,
    );
    // Not theirs to change, or not on the list: the same answer either way.
    if (!changed) return forbidden("You can only change the places you added.");
    return json({ items: await listItems(listId) });
  } catch {
    return unavailable();
  }
}

/** Take a place off the list. Editors can only take back their own. */
export function DELETE(request: Request, context: Context): Promise<Response> {
  return change(request, context, () => ({ remove: true }));
}

/** Change a place's note. */
export function PATCH(request: Request, context: Context): Promise<Response> {
  return change(request, context, (body) => {
    const note = (body as { note?: unknown } | null)?.note;
    if (note === null || note === undefined || note === "") return { note: null };
    if (typeof note !== "string" || note.trim().length > 500)
      return "Each note must be 500 characters or fewer.";
    return { note: note.trim() || null };
  });
}
