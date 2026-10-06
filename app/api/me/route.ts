import { INVALID_JSON, badRequest, json, readJson, requireUser, spendBudget, unavailable } from "@/lib/api";
import { consumePersonalWriteLimits } from "@/lib/otp-rate-limit";
import { avatarUrl, deleteAccount, ensureProfile, parseProfilePatch, profileStats, updateProfile, type Profile } from "@/lib/profiles";
import { database } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getEvidenceBucket } from "@/lib/r2";

function view(profile: Profile) {
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: avatarUrl(profile.avatarKey, profile.handle),
    homeCitySlug: profile.homeCitySlug,
    isPrivate: profile.isPrivate,
    listsPrivateDefault: profile.listsPrivateDefault,
    showOnLeaderboards: profile.showOnLeaderboards,
    defaultFilters: profile.defaultFilters,
    onboarded: profile.onboarded,
  };
}

/** The signed-in person's profile and settings. Creates the profile on first use. */
export async function GET(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/me");
  if (!outcome.ok) return outcome.response;
  try {
    const profile = await ensureProfile(outcome.auth.userId);
    if (!profile) return unavailable();
    const db = await database();
    const [user] = await db.all<{ email: string }>(sql`SELECT email FROM "user" WHERE id = ${outcome.auth.userId}`);
    return json({ profile: view(profile), email: user?.email ?? null, stats: await profileStats(outcome.auth.userId) });
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/me/settings");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const parsed = parseProfilePatch(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const limited = await spendBudget(consumePersonalWriteLimits, outcome.auth);
  if (limited) return limited;
  try {
    const result = await updateProfile(outcome.auth.userId, parsed.patch);
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ profile: view(result.profile) });
  } catch {
    return unavailable();
  }
}

/** Delete the account. Checks stay, anonymously, so place statuses hold. */
export async function DELETE(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/me/settings");
  if (!outcome.ok) return outcome.response;
  try {
    const keys = await deleteAccount(outcome.auth.userId);
    const bucket = await getEvidenceBucket().catch(() => null);
    await Promise.all(keys.map((key) => bucket?.delete?.(key).catch(() => {})));
    return json({ deleted: true });
  } catch {
    return unavailable();
  }
}
