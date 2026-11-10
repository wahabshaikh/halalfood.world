import { badRequest, json, requireUser, spendBudget, unavailable } from "@/lib/api";
import { uuidParam } from "@/lib/core/params";
import { insertRestaurantPhoto } from "@/lib/owner-claims";
import { consumePlacePhotoUploadLimits } from "@/lib/otp-rate-limit";
import { getEvidenceBucket, storePlacePhotoBytes } from "@/lib/r2";
import { readRestaurantImage } from "@/lib/restaurant-upload";

type Context = { params: Promise<{ id: string }> };

/** A photo from the restaurant. It shows with that label only after the claim is public. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const outcome = await requireUser(request, "/claim");
  if (!outcome.ok) return outcome.response;
  const id = uuidParam((await params).id);
  if (!id) return badRequest("That claim could not be found.");
  const image = await readRestaurantImage(request);
  if (!image.ok) return json({ error: image.error }, { status: image.status });
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
    const saved = await insertRestaurantPhoto(id, outcome.auth.userId, {
      r2Key: stored.key,
      contentType: stored.contentType,
      byteSize: stored.sizeBytes,
    });
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
