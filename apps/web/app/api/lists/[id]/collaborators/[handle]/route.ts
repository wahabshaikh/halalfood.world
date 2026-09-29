import {
  getListForViewer,
  listCollaboratorsOf,
  removeCollaborator,
  respondToListInvite,
} from "../../../../../../src/lib/lists-repository";
import { getProfileByHandle } from "../../../../../../src/lib/preferences-repository";
import { validateHandle } from "@halalfood/core/social";
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

type Context = { params: Promise<{ id: string; handle: string }> };

async function target(context: Context) {
  const params = await context.params;
  const listId = placeIdParam(params.id);
  const handle = validateHandle(params.handle);
  return listId && handle.ok ? { listId, handle: handle.handle } : null;
}

/** The invited diner accepts or declines: `{ "accept": true }`. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const ids = await target(context);
  if (!ids) return badRequest("Invalid list or handle.");
  const outcome = await requireUser(request, `/list/${ids.listId}`);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const accept = (body as { accept?: unknown } | null)?.accept;
  if (typeof accept !== "boolean") return badRequest("Say whether you accept.");

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const profile = await getProfileByHandle(ids.handle);
    // You can only answer for yourself.
    if (!profile || profile.userId !== outcome.auth.userId)
      return forbidden("You can only answer your own invite.");
    const answered = await respondToListInvite(ids.listId, outcome.auth.userId, accept);
    if (!answered) return notFound("There is no invite to answer.");
    return json({ accepted: accept });
  } catch {
    return unavailable();
  }
}

/** The owner removes someone, or a collaborator leaves. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const ids = await target(context);
  if (!ids) return badRequest("Invalid list or handle.");
  const outcome = await requireUser(request, `/list/${ids.listId}`);
  if (!outcome.ok) return outcome.response;

  try {
    const [profile, access] = await Promise.all([
      getProfileByHandle(ids.handle),
      getListForViewer(ids.listId, outcome.auth.userId),
    ]);
    if (!access || !profile) return notFound("That list could not be found.");
    const isSelf = profile.userId === outcome.auth.userId;
    if (!isSelf && access.role !== "owner")
      return forbidden("Only the owner can remove other people.");
    await removeCollaborator(ids.listId, profile.userId);
    return json({
      collaborators: (await listCollaboratorsOf(ids.listId)).map(({ userId: _userId, ...person }) => person),
    });
  } catch {
    return unavailable();
  }
}
