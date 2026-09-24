import {
  createList,
  listListsForUser,
} from "../../../src/lib/lists-repository";
import { validateList } from "../../../src/lib/place-lists";
import { consumePersonalWriteLimits } from "../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../src/lib/api";

export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/lists");
  if (!outcome.ok) return outcome.response;
  try {
    return json({
      lists: await listListsForUser(outcome.auth.userId, { includePrivate: true }),
    });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/lists");
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateList(body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    return json({ list: await createList(outcome.auth.userId, validation.data) }, { status: 201 });
  } catch {
    return unavailable();
  }
}
