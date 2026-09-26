import {
  mergeDuplicate,
  resolveEdit,
} from "../../../../../../src/lib/contributions-repository";
import {
  resolveAppeal,
  resolveReport,
  reviewEvidence,
} from "../../../../../../src/lib/moderation-repository";
import { getModeratorRole } from "../../../../../../src/lib/preferences-repository";
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

const KINDS = ["evidence", "edit", "duplicate", "report", "appeal"] as const;
type Kind = (typeof KINDS)[number];

/**
 * One moderation decision. Every branch writes an audit entry through the
 * repository, and an evidence decision additionally re-derives the place status
 * and records the transition.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
): Promise<Response> {
  const { kind: rawKind, id: rawId } = await context.params;
  if (!(KINDS as readonly string[]).includes(rawKind))
    return notFound("Unknown review target.");
  const kind = rawKind as Kind;
  const id = placeIdParam(rawId);
  if (!id) return badRequest("Invalid id.");

  const outcome = await requireUser(request, "/admin");
  if (!outcome.ok) return outcome.response;

  let role: Awaited<ReturnType<typeof getModeratorRole>>;
  try {
    role = await getModeratorRole(outcome.auth.userId);
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
    }
  } catch {
    return unavailable();
  }
}
