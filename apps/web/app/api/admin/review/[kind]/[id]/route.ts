import {
  mergeDuplicate,
  resolveEdit,
} from "../../../../../../src/lib/contributions-repository";
import {
  resolveAppeal,
  resolveReport,
  reviewEvidence,
} from "../../../../../../src/lib/moderation-repository";
import { reviewPlaceSubmission } from "../../../../../../src/lib/place-link-submissions";
import { publishListingChange } from "../../../../../../src/lib/listing-cache";
import { getListingState, parsePin } from "../../../../../../src/lib/listing-moderation";
import { getModeratorRole } from "../../../../../../src/lib/preferences-repository";
import { database } from "../../../../../../src/db";
import type { RequestAuth } from "../../../../../../src/lib/auth-session";
import { placeIdParam } from "@halalfood/core/params";
import {
  INVALID_JSON,
  badRequest,
  forbidden,
  json,
  notFound,
  readJson,
  requireUser,
  unavailable,
} from "../../../../../../src/lib/api";

const KINDS = ["evidence", "edit", "duplicate", "report", "appeal", "place"] as const;
type Kind = (typeof KINDS)[number];

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/**
 * A decision that changes what the public directory shows moves every listing
 * cache to a new key and purges the place's documents. The decision has
 * already committed, so a failure here is logged, not returned: data reads
 * still turn over within seconds and documents within their s-maxage.
 */
async function refreshListing(
  input: { actorUserId: string; change: string; placeId: string; citySlug: string | null },
  db: DatabaseClient | undefined,
): Promise<boolean> {
  try {
    const client = db ?? (await database());
    const citySlug =
      input.citySlug ?? (await getListingState(input.placeId, client))?.citySlug ?? null;
    const { purged } = await publishListingChange({ ...input, citySlug }, client);
    return purged;
  } catch (error) {
    console.warn("listing refresh failed", error instanceof Error ? error.name : "error");
    return false;
  }
}

export type AdminReviewDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  getRole?: (userId: string) => Promise<"moderator" | "admin" | null>;
  database?: DatabaseClient;
};

/**
 * One moderation decision. Every branch writes an audit entry through the
 * repository, and an evidence decision additionally re-derives the place status
 * and records the transition. A place decision lists or rejects a pending
 * submission. The role check reads the moderators table.
 */
export async function handleAdminReview(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
  dependencies: AdminReviewDependencies = {},
): Promise<Response> {
  const { kind: rawKind, id: rawId } = await context.params;
  if (!(KINDS as readonly string[]).includes(rawKind))
    return notFound("Unknown review target.");
  const kind = rawKind as Kind;
  const id = placeIdParam(rawId);
  if (!id) return badRequest("Invalid id.");

  const outcome = await requireUser(request, "/admin", dependencies.getAuth);
  if (!outcome.ok) return outcome.response;

  let role: Awaited<ReturnType<typeof getModeratorRole>>;
  try {
    role = await (dependencies.getRole ?? getModeratorRole)(outcome.auth.userId);
  } catch {
    return unavailable();
  }
  if (!role) return forbidden("This console is for moderators.");

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const input = body as Record<string, unknown>;
  const decision = typeof input.decision === "string" ? input.decision : "";
  const reason =
    typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim().slice(0, 2000)
      : null;

  try {
    switch (kind) {
      case "evidence": {
        if (decision !== "approved" && decision !== "rejected")
          return badRequest("Decide approved or rejected.");
        if (decision === "rejected" && !reason)
          return badRequest("A rejection needs a reason the contributor can read.");
        const result = await reviewEvidence(id, outcome.auth.userId, decision, reason);
        if (!result.ok) return notFound("That submission is no longer pending.");
        // An approved check changes the place's public status, which the
        // place and city documents render.
        if (result.placeId)
          await refreshListing(
            {
              actorUserId: outcome.auth.userId,
              change: `evidence.${decision}`,
              placeId: result.placeId,
              citySlug: null,
            },
            dependencies.database,
          );
        return json({ ok: true, placeId: result.placeId });
      }
      case "edit": {
        if (!["accepted", "rejected", "needs-evidence"].includes(decision))
          return badRequest("Decide accepted, rejected or needs-evidence.");
        if (decision !== "accepted" && !reason)
          return badRequest("Tell the contributor why.");
        const ok = await resolveEdit(
          id,
          outcome.auth.userId,
          decision as "accepted" | "rejected" | "needs-evidence",
          reason,
        );
        if (!ok) return notFound("That edit is no longer pending.");
        return json({ ok: true });
      }
      case "duplicate": {
        if (decision !== "merge") return badRequest("The only duplicate action is merge.");
        const ok = await mergeDuplicate(id, outcome.auth.userId);
        if (!ok) return notFound("That duplicate report is no longer pending.");
        return json({ ok: true });
      }
      case "report": {
        if (decision !== "upheld" && decision !== "dismissed")
          return badRequest("Decide upheld or dismissed.");
        const ok = await resolveReport(id, outcome.auth.userId, decision, reason);
        if (!ok) return notFound("That report is already resolved.");
        return json({ ok: true });
      }
      case "appeal": {
        if (decision !== "upheld" && decision !== "dismissed")
          return badRequest("Decide upheld or dismissed.");
        const ok = await resolveAppeal(id, outcome.auth.userId, decision, reason);
        if (!ok) return notFound("That appeal is already resolved.");
        return json({ ok: true });
      }
      case "place": {
        if (decision !== "approved" && decision !== "rejected")
          return badRequest("Decide approved or rejected.");
        if (decision === "rejected" && !reason)
          return badRequest("A rejection needs a reason the contributor can read.");
        const hasPin =
          (input.lat !== undefined && input.lat !== null && input.lat !== "") ||
          (input.lng !== undefined && input.lng !== null && input.lng !== "");
        const pin = hasPin ? parsePin(input.lat, input.lng) : null;
        if (hasPin && !pin)
          return badRequest("A map pin needs a latitude from -90 to 90 and a longitude from -180 to 180.");
        const result = await reviewPlaceSubmission(
          id,
          outcome.auth.userId,
          decision,
          reason,
          dependencies.database,
          decision === "approved" ? pin : null,
        );
        if (!result.ok && result.reason === "hidden-match")
          return json(
            {
              error:
                "This place is already in the directory but hidden by moderation. Approving a link does not list it again. Reject the link with a reason instead.",
              placeId: result.placeId,
            },
            { status: 409 },
          );
        if (!result.ok) return notFound("That place submission is no longer pending.");
        if (decision === "approved" && result.placeId)
          await refreshListing(
            {
              actorUserId: outcome.auth.userId,
              change: "place.listed",
              placeId: result.placeId,
              citySlug: result.citySlug,
            },
            dependencies.database,
          );
        return json({ ok: true, placeId: result.placeId });
      }
    }
  } catch {
    return unavailable();
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
): Promise<Response> {
  return handleAdminReview(request, context);
}
