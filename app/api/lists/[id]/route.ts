import {
  deleteList,
  getList,
  listItems,
  updateList,
} from "../../../../src/lib/lists-repository";
import { validateList } from "../../../../src/lib/place-lists";
import { placeIdParam } from "../../../../src/lib/params";
import { consumePersonalWriteLimits } from "../../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  forbidden,
  json,
  notFound,
  optionalUser,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../src/lib/api";

/** A private list is only readable by its owner; unlisted needs the link. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");

  try {
    const list = await getList(listId);
    if (!list) return notFound("That list could not be found.");
    if (list.visibility === "private") {
      const userId = await optionalUser(request);
      if (userId !== list.userId) return notFound("That list could not be found.");
    }
    return json(
      { list, items: await listItems(listId) },
      {
        headers: {
          "Cache-Control":
            list.visibility === "public" ? "public, max-age=60" : "no-store",
        },
      },
    );
  } catch {
    return unavailable();
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");

  const outcome = await requireUser(request, "/lists");
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateList(body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const updated = await updateList(listId, outcome.auth.userId, validation.data);
    if (!updated) return forbidden("That list is not yours to edit.");
    return json({ list: await getList(listId) });
  } catch {
    return unavailable();
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");

  const outcome = await requireUser(request, "/lists");
  if (!outcome.ok) return outcome.response;

  try {
    const deleted = await deleteList(listId, outcome.auth.userId);
    if (!deleted) return forbidden("That list is not yours to delete.");
    return json({ deleted: true });
  } catch {
    return unavailable();
  }
}
