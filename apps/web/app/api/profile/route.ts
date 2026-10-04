import {
  getOrCreateProfile,
  updateProfile,
  type DinerProfile,
} from "../../../src/lib/preferences-repository";
import { acceptAllPendingRequests, followCounts } from "../../../src/lib/social-repository";
import { avatarUrl, validateDisplayName, validateHandle } from "@halalfood/core/social";
import { consumePersonalWriteLimits } from "../../../src/lib/otp-rate-limit";
import { citySlugParam } from "@halalfood/core/params";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
} from "../../../src/lib/api";
import { domainFailure, isUniqueConstraint } from "../../../src/lib/domain-error";

const RETURN_TO = "/me";

async function present(profile: DinerProfile) {
  const counts = await followCounts(profile.userId);
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    homeCitySlug: profile.homeCitySlug,
    isPrivate: profile.isPrivate,
    showOnLeaderboards: profile.showOnLeaderboards,
    avatarUrl: avatarUrl(profile.handle, profile.avatarKey),
    ...counts,
  };
}

export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;
  try {
    return json({ profile: await present(await getOrCreateProfile(outcome.auth.userId)) });
  } catch (error) {
    return domainFailure("Your profile", error);
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
    const handle = validateHandle(input.handle);
    if (!handle.ok) return badRequest(handle.error);
    update.handle = handle.handle;
  }
  if (input.displayName !== undefined) {
    if (input.displayName !== null && typeof input.displayName !== "string")
      return badRequest("The display name must be text.");
    const name = typeof input.displayName === "string" ? input.displayName.trim() : null;
    if (name) {
      const validated = validateDisplayName(name);
      if (!validated.ok) return badRequest(validated.error);
      update.displayName = validated.displayName;
    } else update.displayName = null;
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

  if (input.isPrivate !== undefined) {
    if (typeof input.isPrivate !== "boolean")
      return badRequest("Private account must be true or false.");
    update.isPrivate = input.isPrivate;
  }
  if (input.showOnLeaderboards !== undefined) {
    if (typeof input.showOnLeaderboards !== "boolean")
      return badRequest("Show me on leaderboards must be true or false.");
    update.showOnLeaderboards = input.showOnLeaderboards;
  }

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    await updateProfile(outcome.auth.userId, update);
    // Going public settles every request that was waiting on approval.
    if (update.isPrivate === false) await acceptAllPendingRequests(outcome.auth.userId);
  } catch (error) {
    if (isUniqueConstraint(error)) return badRequest("That handle is already taken.");
    return domainFailure("Your profile", error);
  }
  try {
    return json({ profile: await present(await getOrCreateProfile(outcome.auth.userId)) });
  } catch (error) {
    return domainFailure("Your profile", error);
  }
}
