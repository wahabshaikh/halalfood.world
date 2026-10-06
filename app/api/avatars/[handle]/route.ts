import { HANDLE_PATTERN, normalizeHandle } from "@/lib/core/people";
import { getProfileByHandle } from "@/lib/profiles";
import { getEvidenceBucket, isSafeAvatarR2Key } from "@/lib/r2";

/**
 * A profile photo. Photos are public, like the name and handle beside them;
 * the `v` query parameter changes on every upload so a short cache is safe.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ handle: string }> }): Promise<Response> {
  const handle = normalizeHandle(decodeURIComponent((await params).handle));
  if (!handle || !HANDLE_PATTERN.test(handle)) return new Response("Not found", { status: 404 });
  try {
    const profile = await getProfileByHandle(handle);
    if (!profile?.avatarKey || profile.suspended || !isSafeAvatarR2Key(profile.avatarKey)) return new Response("Not found", { status: 404 });
    const bucket = await getEvidenceBucket();
    if (!bucket) return new Response("Unavailable", { status: 503 });
    const object = await bucket.get(profile.avatarKey);
    if (!object?.body) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Unavailable", { status: 503 });
  }
}
