import { listAuditLog } from "../../../../src/lib/moderation-repository";
import { getModeratorRole } from "../../../../src/lib/preferences-repository";
import { forbidden, json, requireUser, unavailable } from "../../../../src/lib/api";

/** Who changed ranking- or halal-sensitive data, when, why and from what source. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/admin");
  if (!outcome.ok) return outcome.response;

  const params = new URL(request.url).searchParams;
  try {
    const role = await getModeratorRole(outcome.auth.userId);
    if (!role) return forbidden("This console is for moderators.");
    return json({
      entries: await listAuditLog({
        targetType: params.get("targetType") ?? undefined,
        targetId: params.get("targetId") ?? undefined,
        limit: Number(params.get("limit")) || 100,
      }),
    });
  } catch {
    return unavailable();
  }
}
