import { badRequest, json, requireUser, spendBudget, unavailable } from "@/lib/api";
import { parseCertifier, parseExpiry } from "@/lib/core/owner-claim";
import { uuidParam } from "@/lib/core/params";
import { fileOwnerCertificate } from "@/lib/owner-claims";
import { consumePlacePhotoUploadLimits } from "@/lib/otp-rate-limit";
import { getEvidenceBucket, storePlacePhotoBytes } from "@/lib/r2";
import { readRestaurantImage, uploadField } from "@/lib/restaurant-upload";

type Context = { params: Promise<{ id: string }> };

/**
 * A photo of a halal certificate. It is filed as pending evidence. A moderator
 * approves it in the existing queue. Payment does not approve it.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const outcome = await requireUser(request, "/claim");
  if (!outcome.ok) return outcome.response;
  const id = uuidParam((await params).id);
  if (!id) return badRequest("That claim could not be found.");
  const image = await readRestaurantImage(request);
  if (!image.ok) return json({ error: image.error }, { status: image.status });
  const certifier = parseCertifier(uploadField(image.fields, "certifier"));
  if (!certifier.ok) return badRequest(certifier.error);
  const expires = parseExpiry(uploadField(image.fields, "expiresOn"), Date.now());
  if (!expires.ok) return badRequest(expires.error);
  const limited = await spendBudget(consumePlacePhotoUploadLimits, outcome.auth, "Too many photo uploads. Please try again later.");
  if (limited) return limited;
  let bucket;
  try {
    bucket = await getEvidenceBucket();
  } catch {
    return unavailable();
  }
  if (!bucket) return unavailable();
  let stored;
  try {
    stored = await storePlacePhotoBytes(bucket, outcome.auth.userId, image.bytes, image.validation);
  } catch {
    return unavailable();
  }
  try {
    const saved = await fileOwnerCertificate(
      id,
      outcome.auth.userId,
      { r2Key: stored.key, contentType: stored.contentType, byteSize: stored.sizeBytes },
      certifier.value,
      expires.value,
    );
    if (!saved.ok) {
      await bucket.delete?.(stored.key);
      return json({ error: saved.error }, { status: saved.status });
    }
    return json({ ok: true, photoId: saved.value.photoId }, { status: 201 });
  } catch {
    await bucket.delete?.(stored.key);
    return unavailable();
  }
}
