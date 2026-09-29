import { markRecsRead } from "../../../../src/lib/recs-repository";
import { json, requireUser, unavailable } from "../../../../src/lib/api";

/** Opening the inbox marks everything in it as seen. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/recs");
  if (!outcome.ok) return outcome.response;
  try {
    await markRecsRead(outcome.auth.userId);
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
