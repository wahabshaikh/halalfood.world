import {
  getListForViewer,
  inviteCollaborator,
  listCollaboratorsOf,
} from "../../../../../src/lib/lists-repository";
import {
  canManageList,
  collaborationConflict,
  validateCollaboratorInvite,
} from "@halalfood/core/place-lists";
import { placeIdParam } from "@halalfood/core/params";
import { dedupeKeys } from "@halalfood/core/notifications";
import { tryNotify } from "../../../../../src/lib/notifications-repository";
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

/** Invite a diner to edit. The owner only, and only on an unranked list. */
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
  const invite = validateCollaboratorInvite(body);
  if (!invite.ok) return badRequest(invite.error);

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const access = await getListForViewer(listId, outcome.auth.userId);
    if (!access) return notFound("That list could not be found.");
    if (!canManageList(access.role)) return forbidden("Only the owner can invite people.");
    const conflict = collaborationConflict(access.list);
    if (conflict) return badRequest(conflict);

    const result = await inviteCollaborator(listId, outcome.auth.userId, invite.handle);
    if (!result.ok) {
      if (result.reason === "not-found") return notFound("No diner with that handle.");
      if (result.reason === "self") return badRequest("You already own this list.");
      if (result.reason === "exists") return badRequest("They are already invited.");
      return badRequest("This list has as many collaborators as it can hold.");
    }
    await tryNotify({
      userId: result.person.userId,
      kind: "list-invite",
      actorId: outcome.auth.userId,
      listId,
      dedupeKey: dedupeKeys.listInvite(listId),
    });
    return json(
      {
        collaborators: (await listCollaboratorsOf(listId)).map(({ userId: _userId, ...person }) => person),
      },
      { status: 201 },
    );
  } catch {
    return unavailable();
  }
}
