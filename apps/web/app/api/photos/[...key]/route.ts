import { d1PlacePhotoRepository } from "../../../../src/lib/place-photos";
import { getEvidenceBucket, isSafePhotoR2Key } from "../../../../src/lib/r2";

/** Serve a place photo from R2. The database row is the access check. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.map(decodeURIComponent).join("/");
  if (!isSafePhotoR2Key(key)) return new Response("Not found", { status: 404 });
  try {
    const access = await d1PlacePhotoRepository().getUploadAccess(key);
    if (!access) return new Response("Not found", { status: 404 });
    const bucket = await getEvidenceBucket();
    if (!bucket) return new Response("Unavailable", { status: 503 });
    const object = await bucket.get(key);
    if (!object?.body) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": access.contentType,
        "Content-Disposition": `inline; filename="${access.fileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Unavailable", { status: 503 });
  }
}
