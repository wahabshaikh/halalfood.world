import { json, notFound, optionalUser, unavailable } from "../../../../src/lib/api";
import { getVisit, likers } from "../../../../src/lib/feed";
import { visitJson } from "../../../../src/lib/visit-json";

const ID = /^[0-9a-f-]{36}$/i;

/** The visit page payload, under the check's privacy. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = (await params).id;
  if (!ID.test(id)) return notFound("This visit isn’t available.");
  try {
    const viewerId = await optionalUser(request);
    const visit = await getVisit(id, viewerId);
    if (!visit) return notFound("This visit isn’t available.");
    return json({ visit: visitJson(visit), likers: await likers(id, viewerId) });
  } catch {
    return unavailable();
  }
}
