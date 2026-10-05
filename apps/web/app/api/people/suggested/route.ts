import { citySlugParam } from "@halalfood/core/params";
import { json, requireUser, unavailable } from "../../../../src/lib/api";
import { suggestedPeople } from "../../../../src/lib/people";
import { avatarUrl } from "../../../../src/lib/profiles";

/** Onboarding "Popular in {city}": up to 10 public people to follow. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/welcome");
  if (!outcome.ok) return outcome.response;
  const city = citySlugParam(new URL(request.url).searchParams.get("city"));
  try {
    const people = await suggestedPeople(outcome.auth.userId, city);
    return json({
      people: people.map((person) => ({
        handle: person.handle,
        name: person.name,
        avatarUrl: avatarUrl(person.avatarKey, person.handle),
        followers: person.followers,
      })),
    });
  } catch {
    return unavailable();
  }
}
