import { json, notFound, unavailable } from "../../../../../src/lib/api";
import { getCreatorProfile, isMediaPlatform, normalizeHandle } from "../../../../../src/lib/media-links";

/** Linked videos with place status. */
export async function GET(_request: Request, { params }: { params: Promise<{ platform: string; handle: string }> }): Promise<Response> {
  const { platform, handle: raw } = await params;
  const handle = normalizeHandle(decodeURIComponent(raw));
  if (!isMediaPlatform(platform) || !handle) return notFound();
  try {
    const creator = await getCreatorProfile(platform, handle);
    return creator ? json({ creator }) : notFound();
  } catch {
    return unavailable();
  }
}
