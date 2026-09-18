import {
  getOrCreateProfile,
  isValidHandle,
  updateProfile,
} from "../../../src/lib/preferences-repository";
import { consumePersonalWriteLimits } from "../../../src/lib/otp-rate-limit";
import { citySlugParam } from "../../../src/lib/params";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../src/lib/api";

const RETURN_TO = "/me";

export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ profile: await getOrCreateProfile(outcome.auth.userId) });
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const input = body as Record<string, unknown>;

  const update: Parameters<typeof updateProfile>[1] = {};
  if (input.handle !== undefined) {
    if (!isValidHandle(input.handle))
      return badRequest("Handles are 3-32 characters: letters, numbers, - and _.");
    update.handle = input.handle;
  }
  if (input.displayName !== undefined) {
    if (input.displayName !== null && typeof input.displayName !== "string")
      return badRequest("The display name must be text.");
    const name = typeof input.displayName === "string" ? input.displayName.trim() : null;
    if (name && name.length > 60)
      return badRequest("The display name must be 60 characters or fewer.");
    update.displayName = name || null;
  }
  if (input.bio !== undefined) {
    if (input.bio !== null && typeof input.bio !== "string")
      return badRequest("The bio must be text.");
    const bio = typeof input.bio === "string" ? input.bio.trim() : null;
    if (bio && bio.length > 280)
      return badRequest("The bio must be 280 characters or fewer.");
    update.bio = bio || null;
  }
  if (input.homeCitySlug !== undefined) {
    if (input.homeCitySlug === null || input.homeCitySlug === "") update.homeCitySlug = null;
    else {
      const slug = citySlugParam(input.homeCitySlug as string);
      if (!slug) return badRequest("Home city must be a valid city slug.");
      update.homeCitySlug = slug;
    }
  }

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    await updateProfile(outcome.auth.userId, update);
    return json({ profile: await getOrCreateProfile(outcome.auth.userId) });
  } catch {
    return badRequest("That handle is already taken.");
  }
}
