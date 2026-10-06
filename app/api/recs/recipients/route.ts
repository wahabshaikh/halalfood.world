import { json, requireUser, unavailable } from "@/lib/api";
import { recipients } from "@/lib/inbox";
import { avatarUrl } from "@/lib/profiles";

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
