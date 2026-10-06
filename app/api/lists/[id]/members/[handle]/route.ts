import { normalizeHandle } from "@/lib/core/people";
import { json, notFound, requireUser, unavailable } from "@/lib/api";
import { removeMember } from "@/lib/lists";

/** Leave a plan, or remove someone from yours. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; handle: string }> }): Promise<Response> {
  const { id, handle: raw } = await params;
  const handle = normalizeHandle(decodeURIComponent(raw));
  if (!handle) return notFound();
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  try {
    const result = await removeMember(id, outcome.auth.userId, handle);
    return result.ok ? json({ removed: true }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
