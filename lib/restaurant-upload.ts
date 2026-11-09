/**
 * Read one restaurant image from a multipart body. Validation matches place photos:
 * JPEG, PNG or WebP, 8 MB, and the bytes have to match the declared type.
 */
import { MAX_PLACE_PHOTO_BYTES, validatePlacePhotoFile, type PlacePhotoUploadValidation } from "@/lib/r2";

const OVERHEAD = 256 * 1024;

type Ready = { ok: true; bytes: Uint8Array; validation: Extract<PlacePhotoUploadValidation, { ok: true }>; fields: FormData };
type Rejected = { ok: false; status: number; error: string };

export async function readRestaurantImage(request: Request): Promise<Ready | Rejected> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("multipart/form-data")) return { ok: false, status: 400, error: "Upload a photo using multipart form data." };
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PLACE_PHOTO_BYTES + OVERHEAD) {
    return { ok: false, status: 413, error: "Photos must be 8 MiB or smaller." };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, status: 400, error: "The photo upload could not be read." };
  }
  const value = form.get("file");
  if (!value || typeof value !== "object") return { ok: false, status: 400, error: "Choose a photo to upload." };
  const file = value as Partial<{ type: string; size: number; name: string; arrayBuffer(): Promise<ArrayBuffer> }>;
  if (typeof file.type !== "string" || typeof file.size !== "number" || typeof file.name !== "string" || typeof file.arrayBuffer !== "function") {
    return { ok: false, status: 400, error: "Choose a valid image file to upload." };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, status: 400, error: "The photo upload could not be read." };
  }
  const validation = validatePlacePhotoFile({ contentType: file.type, sizeBytes: file.size, fileName: file.name, bytes });
  if (!validation.ok) return { ok: false, status: validation.status, error: validation.error };
  if (bytes.byteLength !== validation.sizeBytes) return { ok: false, status: 400, error: "The photo size could not be verified." };
  return { ok: true, bytes, validation, fields: form };
}

export function uploadField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
