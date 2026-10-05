import { placeIdParam } from "@halalfood/core/params";
import { badRequest, json, requireUser, unavailable } from "../../../../src/lib/api";
import { listsICanAddTo } from "../../../../src/lib/lists";

/** `?place=`: the lists you can add that place to, with whether it's already there. */
export async function GET(request: Request): Promise<Response> {
  const placeId = placeIdParam(new URL(request.url).searchParams.get("place") ?? "");
  if (!placeId) return badRequest("Choose a place.");
  const outcome = await requireUser(request, `/place/${placeId}`);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ lists: await listsICanAddTo(outcome.auth.userId, placeId) });
  } catch {
    return unavailable();
  }
}
