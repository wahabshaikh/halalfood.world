import { avatarUrl } from "@halalfood/core/social";
import { listConnections } from "../../../src/lib/social-repository";
import { json, requireUser } from "../../../src/lib/api";
import { domainFailure } from "../../../src/lib/domain-error";

/** Requests other diners have made to follow the signed-in diner. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/settings");
  if (!outcome.ok) return outcome.response;
  try {
    const people = await listConnections(
      outcome.auth.userId,
      "requests",
      outcome.auth.userId,
    );
    return json({
      requests: people.map((person) => ({
        handle: person.handle,
        displayName: person.displayName,
        avatarUrl: avatarUrl(person.handle, person.avatarKey),
      })),
    });
  } catch (error) {
    return domainFailure("Follow requests", error);
  }
}
