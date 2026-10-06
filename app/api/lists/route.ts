import { placeIdParam } from "@/lib/core/params";
import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { createList, myLists, parseListFields } from "@/lib/lists";
import { isModerator } from "@/lib/moderators";
import { consumePersonalWriteLimits } from "@/lib/otp-rate-limit";

/** Mine, grouped `{own, planning, saved}`. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/saved?tab=lists");
  if (!outcome.ok) return outcome.response;
  try {
    return json(await myLists(outcome.auth.userId));
  } catch {
    return unavailable();
  }
}

/** Body `{title, kind, visibility?, caption?, placeId?}`. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/saved?tab=lists");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseListFields(body, true);
  if (!parsed.ok) return badRequest(parsed.error);
  const rawPlace = (body as { placeId?: unknown }).placeId;
  const placeId = rawPlace ? placeIdParam(String(rawPlace)) : null;
  if (rawPlace && !placeId) return badRequest("That place id is not valid.");
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await createList(
      outcome.auth.userId,
      { ...parsed.fields, title: parsed.fields.title!, kind: parsed.fields.kind! },
      { moderator: await isModerator(outcome.auth.userId), placeId },
    );
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ id: result.value }, { status: 201 });
  } catch {
    return unavailable();
  }
}
