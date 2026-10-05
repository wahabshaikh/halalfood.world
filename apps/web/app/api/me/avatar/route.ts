import { badRequest, json, requireUser, spendBudget, unavailable } from "../../../../src/lib/api";
import { consumePlacePhotoUploadLimits } from "../../../../src/lib/otp-rate-limit";
import { avatarUrl, ensureProfile, setAvatarKey } from "../../../../src/lib/profiles";
import { MAX_AVATAR_BYTES, getEvidenceBucket, isSafeAvatarR2Key, storeAvatarFile } from "../../../../src/lib/r2";

const RETURN_TO = "/me/settings";

/** Replace the signed-in person's profile photo: multipart form, field `file`. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("multipart/form-data")) return badRequest("Upload a photo using multipart form data.");
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES + 256 * 1024)
    return json({ error: "Profile photos must be 2 MB or smaller." }, { status: 413 });
  const limited = await spendBudget(consumePlacePhotoUploadLimits, outcome.auth);
  if (limited) return limited;
  const bucket = await getEvidenceBucket();
  if (!bucket) return unavailable("Photo uploads are temporarily unavailable.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("The upload could not be read.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return badRequest("Choose a photo to upload.");

  try {
    const profile = await ensureProfile(outcome.auth.userId);
    if (!profile) return unavailable();
    const stored = await storeAvatarFile(bucket, outcome.auth.userId, file);
    if (!stored.ok) return json({ error: stored.error }, { status: stored.status });
    await setAvatarKey(outcome.auth.userId, stored.key);
    if (profile.avatarKey && isSafeAvatarR2Key(profile.avatarKey)) await bucket.delete?.(profile.avatarKey).catch(() => {});
    return json({ avatarUrl: avatarUrl(stored.key, profile.handle) }, { status: 201 });
  } catch {
    return unavailable();
  }
}

/** Remove the profile photo. */
export async function DELETE(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;
  try {
    const profile = await ensureProfile(outcome.auth.userId);
    await setAvatarKey(outcome.auth.userId, null);
    if (profile?.avatarKey && isSafeAvatarR2Key(profile.avatarKey)) {
      const bucket = await getEvidenceBucket();
      await bucket?.delete?.(profile.avatarKey).catch(() => {});
    }
    return json({ avatarUrl: null });
  } catch {
    return unavailable();
  }
}
