import { placeIdParam } from "@halalfood/core/params";
import { database } from "../../../../../src/db";
import type { RequestAuth } from "../../../../../src/lib/auth-session";
import { publishListingChange } from "../../../../../src/lib/listing-cache";
import {
  getListingState,
  parsePin,
  pinPlace,
  restorePlace,
  unpublishPlace,
  type ListingActionResult,
} from "../../../../../src/lib/listing-moderation";
import { getModeratorRole } from "../../../../../src/lib/preferences-repository";
import {
  INVALID_JSON,
  badRequest,
  forbidden,
  json,
  notFound,
  readJson,
  requireUser,
  unavailable,
} from "../../../../../src/lib/api";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export type AdminPlaceDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  getRole?: (userId: string) => Promise<"moderator" | "admin" | null>;
  database?: DatabaseClient;
};

type Context = { params: Promise<{ id: string }> };

async function moderator(
  request: Request,
  placeId: string,
  dependencies: AdminPlaceDependencies,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const outcome = await requireUser(request, `/place/${placeId}`, dependencies.getAuth);
  if (!outcome.ok) return outcome;
  let role: Awaited<ReturnType<typeof getModeratorRole>>;
  try {
    role = await (dependencies.getRole ?? getModeratorRole)(outcome.auth.userId);
  } catch {
    return { ok: false, response: unavailable() };
  }
  if (!role) return { ok: false, response: forbidden("This control is for moderators.") };
  return { ok: true, userId: outcome.auth.userId };
}

/** The listing state a moderator control needs. Anyone else gets 401 or 403. */
export async function handleAdminPlaceGet(
  request: Request,
  context: Context,
  dependencies: AdminPlaceDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await context.params).id);
  if (!placeId) return badRequest("Invalid place id.");
  const access = await moderator(request, placeId, dependencies);
  if (!access.ok) return access.response;
  try {
    const state = await getListingState(placeId, dependencies.database ?? database());
    if (!state) return notFound("That place is not in the directory.");
    return json({ listing: state }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}

const REFUSALS: Record<Exclude<ListingActionResult, { ok: true }>["reason"], [number, string]> = {
  "not-found": [404, "That place is not in the directory."],
  "not-listed": [409, "That place is not listed right now."],
  "not-restorable": [
    409,
    "Only a place a moderator unpublished can be restored here. Places hidden by the listing rules (for example alcohol-led venues) stay hidden.",
  ],
  "bad-pin": [400, "A map pin needs a latitude from -90 to 90 and a longitude from -180 to 180."],
};

/**
 * Unpublish, restore or pin one place. Every action writes an audit entry,
 * then moves the listing caches to a new version and purges the place's
 * documents so the change shows at once.
 */
export async function handleAdminPlacePost(
  request: Request,
  context: Context,
  dependencies: AdminPlaceDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await context.params).id);
  if (!placeId) return badRequest("Invalid place id.");
  const access = await moderator(request, placeId, dependencies);
  if (!access.ok) return access.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const input = body as Record<string, unknown>;
  const action = typeof input.action === "string" ? input.action : "";
  const reason =
    typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim().slice(0, 2000)
      : null;

  try {
    const db = dependencies.database ?? (await database());
    let result: ListingActionResult;
    switch (action) {
      case "unpublish":
        if (!reason) return badRequest("Unpublishing needs a reason. It is kept on the audit log.");
        result = await unpublishPlace(placeId, access.userId, reason, db);
        break;
      case "restore":
        result = await restorePlace(placeId, access.userId, reason, db);
        break;
      case "pin": {
        const pin = parsePin(input.lat, input.lng);
        result = pin
          ? await pinPlace(placeId, access.userId, pin, db)
          : { ok: false, reason: "bad-pin" };
        break;
      }
      default:
        return badRequest("Choose unpublish, restore or pin.");
    }
    if (!result.ok) {
      const [status, error] = REFUSALS[result.reason];
      return json({ error }, { status });
    }
    let purged = false;
    try {
      ({ purged } = await publishListingChange(
        {
          actorUserId: access.userId,
          change: `place.${action}`,
          placeId,
          citySlug: result.state.citySlug,
        },
        db,
      ));
    } catch (error) {
      console.warn("listing refresh failed", error instanceof Error ? error.name : "error");
    }
    return json({ ok: true, listing: result.state, purged });
  } catch {
    return unavailable();
  }
}

export function GET(request: Request, context: Context) {
  return handleAdminPlaceGet(request, context);
}

export function POST(request: Request, context: Context) {
  return handleAdminPlacePost(request, context);
}
