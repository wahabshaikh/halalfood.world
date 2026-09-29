import {
  getEditToken,
  getListForViewer,
  setEditLink,
} from "../../../../../src/lib/lists-repository";
import { canManageList, collaborationConflict } from "@halalfood/core/place-lists";
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

type Context = { params: Promise<{ id: string }> };

function linkFor(listId: string, token: string) {
  return `/list/${listId}?join=${token}`;
}

/** The owner reads the current edit link, if it is on. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");
  const outcome = await requireUser(request, `/list/${listId}`);
  if (!outcome.ok) return outcome.response;
  try {
    const token = await getEditToken(listId, outcome.auth.userId);
    return json({ enabled: Boolean(token), path: token ? linkFor(listId, token) : null });
  } catch {
    return unavailable();
  }
}

/** Turn the edit link on or off: `{ "enabled": true }`. Turning it on again makes a new link. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const listId = placeIdParam((await context.params).id);
  if (!listId) return badRequest("Invalid list id.");
  const outcome = await requireUser(request, `/list/${listId}`);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") return badRequest("Say whether the link is on.");

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const access = await getListForViewer(listId, outcome.auth.userId);
    if (!access) return notFound("That list could not be found.");
    if (!canManageList(access.role)) return forbidden("Only the owner can do that.");
    if (enabled) {
      const conflict = collaborationConflict(access.list);
      if (conflict) return badRequest(conflict);
    }
    const token = await setEditLink(listId, outcome.auth.userId, enabled);
    return json({ enabled, path: token ? linkFor(listId, token) : null });
  } catch {
    return unavailable();
  }
}
