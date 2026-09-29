import { avatarUrl } from "@halalfood/core/social";
import {
  consumePlacePhotoUploadLimits,
} from "../../../../src/lib/otp-rate-limit";
import { getOrCreateProfile } from "../../../../src/lib/preferences-repository";
import { setAvatarKey } from "../../../../src/lib/social-repository";
import {
  MAX_AVATAR_BYTES,
  getEvidenceBucket,
  isSafeAvatarR2Key,
  storeAvatarFile,
} from "../../../../src/lib/r2";
import {
  badRequest,
  json,
  requireUser,
  spendBudget,
  unavailable,
} from "../../../../src/lib/api";

const RETURN_TO = "/settings";

/** Replace the signed-in diner's profile photo: multipart form, field `file`. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;

  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("multipart/form-data"))
    return badRequest("Upload a photo using multipart form data.");
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES + 256 * 1024)
    return json({ error: "Profile photos must be 2 MiB or smaller." }, { status: 413 });

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
  const value = form.get("file");
  if (!value || typeof value !== "object") return badRequest("Choose a photo to upload.");
  const file = value as Partial<{
    type: string;
    size: number;
    name: string;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  if (
    typeof file.type !== "string" ||
    typeof file.size !== "number" ||
    typeof file.name !== "string" ||
    typeof file.arrayBuffer !== "function"
  )
    return badRequest("Choose a valid photo to upload.");

  try {
    const previous = (await getOrCreateProfile(outcome.auth.userId)).avatarKey;
    const stored = await storeAvatarFile(bucket, outcome.auth.userId, {
      type: file.type,
      size: file.size,
      name: file.name,
      arrayBuffer: () => file.arrayBuffer!(),
    });
    if (!stored.ok) return json({ error: stored.error }, { status: stored.status });
    await setAvatarKey(outcome.auth.userId, stored.key);
    if (previous && isSafeAvatarR2Key(previous)) await bucket.delete?.(previous).catch(() => {});
    const profile = await getOrCreateProfile(outcome.auth.userId);
    return json({ avatarUrl: avatarUrl(profile.handle, profile.avatarKey) }, { status: 201 });
  } catch {
    return unavailable();
  }
}

/** Remove the profile photo. */
export async function DELETE(request: Request): Promise<Response> {
  const outcome = await requireUser(request, RETURN_TO);
  if (!outcome.ok) return outcome.response;
  const limited = await spendBudget(consumePlacePhotoUploadLimits, outcome.auth);
  if (limited) return limited;
  try {
    const profile = await getOrCreateProfile(outcome.auth.userId);
    await setAvatarKey(outcome.auth.userId, null);
    if (profile.avatarKey && isSafeAvatarR2Key(profile.avatarKey)) {
      const bucket = await getEvidenceBucket();
      await bucket?.delete?.(profile.avatarKey).catch(() => {});
    }
    return json({ avatarUrl: null });
  } catch {
    return unavailable();
  }
}
