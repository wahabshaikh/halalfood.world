import { avatarUrl } from "@halalfood/core/social";
import { listBlocked } from "../../../src/lib/social-repository";
import { json, requireUser } from "../../../src/lib/api";
import { domainFailure } from "../../../src/lib/domain-error";

export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/settings");
  if (!outcome.ok) return outcome.response;
  try {
    const people = await listBlocked(outcome.auth.userId);
    return json({
      blocked: people.map((person) => ({
        handle: person.handle,
        displayName: person.displayName,
        avatarUrl: avatarUrl(person.handle, person.avatarKey),
      })),
    });
  } catch (error) {
    return domainFailure("Blocked people", error);
  }
}
