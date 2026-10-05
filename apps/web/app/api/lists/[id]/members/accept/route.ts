import { json, requireUser, unavailable } from "../../../../../../src/lib/api";
import { acceptInvite } from "../../../../../../src/lib/lists";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  try {
    const result = await acceptInvite(id, outcome.auth.userId);
    return result.ok ? json({ accepted: true }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}
