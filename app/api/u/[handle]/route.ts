import { normalizeHandle } from "@/lib/core/people";
import { json, notFound, optionalUser, unavailable } from "@/lib/api";
import { avatarUrl } from "@/lib/profiles";
import { loadPublicProfile } from "@/lib/public-profile";
import { visitJson } from "@/lib/visit-json";

/** A public profile with counts, gated by privacy and blocks. */
export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }): Promise<Response> {
  const handle = normalizeHandle(decodeURIComponent((await params).handle));
  if (!handle) return notFound("That person could not be found.");
  try {
    const data = await loadPublicProfile(handle, await optionalUser(request));
    if (!data) return notFound("That person could not be found.");
    const { profile } = data;
    return json({
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: avatarUrl(profile.avatarKey, profile.handle),
      homeCitySlug: profile.homeCitySlug,
      isPrivate: profile.isPrivate,
      relation: data.relation,
      canView: data.canView,
      followers: data.followers,
      following: data.following,
      rank: data.rank,
      stats: data.stats,
      lists: data.lists,
      visits: data.visits.map(visitJson),
    });
  } catch {
    return unavailable();
  }
}
