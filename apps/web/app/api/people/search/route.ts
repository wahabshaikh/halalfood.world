import { avatarUrl } from "@halalfood/core/social";
import { searchPeople } from "../../../../src/lib/social-repository";
import { json, optionalUser } from "../../../../src/lib/api";
import { domainFailure } from "../../../../src/lib/domain-error";

/** Find diners by handle or name. Needs at least two characters. */
export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.trim().replace(/^@/, "").length < 2) return json({ people: [] });
  try {
    const viewerId = await optionalUser(request);
    const people = await searchPeople(q.slice(0, 64), viewerId);
    return json({
      people: people.map((person) => ({
        handle: person.handle,
        displayName: person.displayName,
        isPrivate: person.isPrivate,
        avatarUrl: avatarUrl(person.handle, person.avatarKey),
      })),
    });
  } catch (error) {
    return domainFailure("Finding people", error);
  }
}
