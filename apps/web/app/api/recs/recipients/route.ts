import { json, requireUser, unavailable } from "../../../../src/lib/api";
import { recipients } from "../../../../src/lib/inbox";
import { avatarUrl } from "../../../../src/lib/profiles";

export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/inbox?tab=recs");
  if (!outcome.ok) return outcome.response;
  try {
    const people = await recipients(outcome.auth.userId);
    return json({ people: people.map((person) => ({ handle: person.handle, name: person.name, avatarUrl: avatarUrl(person.avatarKey, person.handle) })) });
  } catch {
    return unavailable();
  }
}
