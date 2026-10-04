import { listRecipients } from "../../../../src/lib/recs-repository";
import { json, requireUser } from "../../../../src/lib/api";
import { domainFailure } from "../../../../src/lib/domain-error";

/** The friends a rec can go to: people you follow and people who follow you. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/send");
  if (!outcome.ok) return outcome.response;
  try {
    return json({ people: await listRecipients(outcome.auth.userId) });
  } catch (error) {
    return domainFailure("Your friends", error);
  }
}
