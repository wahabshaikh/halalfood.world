import { avatarUrl, validateOnboarding } from "@halalfood/core/social";
import { consumePersonalWriteLimits } from "../../../src/lib/otp-rate-limit";
import { getOrCreateProfile, getPreferences } from "../../../src/lib/preferences-repository";
import { completeOnboarding } from "../../../src/lib/social-repository";
import {
  INVALID_JSON,
  badRequest,
  json,
  readJson,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../src/lib/api";

const RETURN_TO = "/onboarding";

/** Where the signed-in diner stands: their profile, standard and whether they are done. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;
  try {
    const [profile, preferences] = await Promise.all([
      getOrCreateProfile(outcome.auth.userId),
      getPreferences(outcome.auth.userId),
    ]);
    return json({
      completed: profile.onboardedAt !== null,
      profile: {
        handle: profile.handle,
        displayName: profile.displayName,
        homeCitySlug: profile.homeCitySlug,
        avatarUrl: avatarUrl(profile.handle, profile.avatarKey),
        // A derived handle means the person has not chosen one yet.
        handleChosen: profile.onboardedAt !== null || !/^diner-[0-9a-f]{10}$/.test(profile.handle),
      },
      preferences,
    });
  } catch {
    return unavailable();
  }
}

/** Finish onboarding. Name and handle are required; everything else is optional. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const validation = validateOnboarding(body);
  if (!validation.ok) return badRequest(validation.error);

  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;

  try {
    const result = await completeOnboarding(outcome.auth.userId, validation.data);
    if (!result.ok)
      return json({ error: "That handle is taken." }, { status: 409 });
    return json({
      profile: {
        handle: result.profile.handle,
        displayName: result.profile.displayName,
        avatarUrl: avatarUrl(result.profile.handle, result.profile.avatarKey),
      },
      followed: result.followed,
    });
  } catch {
    return unavailable();
  }
}
