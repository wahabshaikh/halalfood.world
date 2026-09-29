import {
  deleteList,
  getListForViewer,
  hasCollaborators,
  listCollaboratorsOf,
  listHasPlace,
  listItems,
  updateList,
} from "../../../../src/lib/lists-repository";
import {
  canManageList,
  collaborationConflict,
  listProgress,
  validateList,
} from "@halalfood/core/place-lists";
import { placeIdParam } from "@halalfood/core/params";
import { listVisitedPlaceIds } from "../../../../src/lib/visits";
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

/**
 * A list as the viewer may see it. Private lists belong to their people, a
 * block hides a list both ways and a private account's lists open only for its
 * followers, so all of them read as missing to anyone else.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");

  try {
    const viewerId = await optionalUser(request);
    const access = await getListForViewer(listId, viewerId);
    if (!access) return notFound("That list could not be found.");
    const [items, visited, collaborators] = await Promise.all([
      listItems(listId),
      viewerId ? listVisitedPlaceIds(viewerId) : Promise.resolve(new Set<string>()),
      access.role === "owner" || access.role === "editor" || access.role === "invited"
        ? listCollaboratorsOf(listId)
        : Promise.resolve([]),
    ]);
    return json({
      list: access.list,
      owner: access.owner,
      role: access.role,
      saved: access.saved,
      editLinkOn: access.editLinkOn,
      collaborators: collaborators.map(({ userId: _userId, ...person }) => person),
      progress: viewerId ? listProgress(items, visited) : null,
      items,
    });
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
    const access = await getListForViewer(listId, outcome.auth.userId);
    if (!access) return notFound("That list could not be found.");
    if (!canManageList(access.role)) return forbidden("That list is not yours to edit.");

    // A group plan and a personal ranking are different things.
    if (validation.data.ranked && (access.editLinkOn || (await hasCollaborators(listId)))) {
      const conflict = collaborationConflict({ ranked: true, visibility: validation.data.visibility });
      return badRequest(
        `${conflict} Remove the collaborators and turn off the edit link first.`,
      );
    }
    if (
      validation.data.coverPlaceId &&
      !(await listHasPlace(listId, validation.data.coverPlaceId))
    )
      return badRequest("The cover must be one of the list's places.");

    const updated = await updateList(listId, outcome.auth.userId, validation.data);
    if (!updated) return forbidden("That list is not yours to edit.");
    return json({ list: (await getListForViewer(listId, outcome.auth.userId))?.list });
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
