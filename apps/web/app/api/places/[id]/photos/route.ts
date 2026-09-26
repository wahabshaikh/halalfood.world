import { getRequestAuth, type RequestAuth } from "../../../../../src/lib/auth-session";
import { placeIdParam } from "@halalfood/core/params";
import {
  consumePlacePhotoMutationLimits,
  consumePlacePhotoUploadLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../../src/lib/otp-rate-limit";
import {
  deletePlacePhotoForUser,
  d1PlacePhotoRepository,
  registerPlacePhotoForUser,
  type PlacePhoto,
  type PlacePhotoRepository,
} from "../../../../../src/lib/place-photos";
import {
  getEvidenceBucket,
  MAX_PLACE_PHOTO_BYTES,
  storePlacePhotoBytes,
  validatePlacePhotoFile,
  type R2BucketLike,
} from "../../../../../src/lib/r2";

const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(placeId: string) {
  return Response.json(
    {
      error: "Sign in to add a halal place photo.",
      loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`,
    },
    { status: 401, headers: noStore() },
  );
}

function unavailable() {
  return Response.json(
    { error: "Halal place photos are temporarily unavailable. Please try again." },
    { status: 503, headers: noStore() },
  );
}

function invalidPlace() {
  return Response.json(
    { error: "Invalid place id." },
    { status: 400, headers: noStore() },
  );
}

function notFound() {
  return Response.json(
    { error: "That halal place could not be found." },
    { status: 404, headers: noStore() },
  );
}

function photoNotFound() {
  return Response.json(
    { error: "Your halal place photo could not be found." },
    { status: 404, headers: noStore() },
  );
}

function rateLimited(retryAfterMs: number, action: "upload" | "mutation") {
  const seconds = retryAfterSeconds(retryAfterMs);
  return Response.json(
    {
      error:
        action === "upload"
          ? "Too many photo uploads. Please try again later."
          : "Too many photo actions. Please try again later.",
    },
    {
      status: 429,
      headers: {
        ...noStore(),
        "Retry-After": String(seconds),
        "X-Retry-After": String(seconds),
      },
    },
  );
}

function uploadUrl(key: string): string {
  return `/api/uploads/r2?key=${encodeURIComponent(key)}`;
}

function photoPayload(photo: PlacePhoto) {
  return {
    id: photo.id,
    url: uploadUrl(photo.r2Key),
    contentType: photo.contentType,
    byteSize: photo.byteSize,
    fileName: photo.fileName,
    createdAt: photo.createdAt,
    isOwn: photo.isOwn,
  };
}

type AuthenticatedRequestAuth = Extract<
  RequestAuth,
  { status: "authenticated" }
>;

export type PlacePhotosRouteDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  consumeUploadLimits?: typeof consumePlacePhotoUploadLimits;
  consumeMutationLimits?: typeof consumePlacePhotoMutationLimits;
  repository?: PlacePhotoRepository;
  getBucket?: () => Promise<R2BucketLike | null>;
};

async function authenticate(
  request: Request,
  placeId: string,
  dependencies: PlacePhotosRouteDependencies,
): Promise<{ auth: AuthenticatedRequestAuth } | { response: Response }> {
  let auth: RequestAuth;
  try {
    auth = await (dependencies.getAuth ?? getRequestAuth)(request);
  } catch {
    return { response: unavailable() };
  }
  if (auth.status === "unavailable") return { response: unavailable() };
  if (auth.status === "unauthenticated") return { response: unauthorized(placeId) };
  return { auth };
}

async function removeObject(bucket: R2BucketLike, key: string): Promise<void> {
  if (typeof bucket.delete !== "function") return;
  try {
    await bucket.delete(key);
  } catch {
    // A database row is the access-control source of truth. Cleanup is best effort.
  }
}

export async function handlePlacePhotosGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: PlacePhotosRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return invalidPlace();

  let userId: string | null = null;
  try {
    const auth = await (dependencies.getAuth ?? getRequestAuth)(request);
    if (auth.status === "authenticated") userId = auth.userId;
  } catch {
    // Gallery reads remain public if the optional ownership lookup is unavailable.
  }

  try {
    const repository = dependencies.repository ?? d1PlacePhotoRepository();
    if (!(await repository.hasPlace(placeId))) return notFound();
    const photos = await repository.list(placeId, userId);
    return Response.json(
      { placeId, photos: photos.map(photoPayload) },
      { headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}

export async function handlePlacePhotosPost(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: PlacePhotosRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return invalidPlace();

  const gate = await authenticate(request, placeId, dependencies);
  if ("response" in gate) return gate.response;

  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("multipart/form-data"))
    return Response.json(
      { error: "Upload a photo using multipart form data." },
      { status: 400, headers: noStore() },
    );

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_PLACE_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES
  )
    return Response.json(
      { error: "Photos must be 8 MiB or smaller." },
      { status: 413, headers: noStore() },
    );

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "The photo upload could not be read." },
      { status: 400, headers: noStore() },
    );
  }

  const value = form.get("file");
  if (!value || typeof value !== "object")
    return Response.json(
      { error: "Choose a photo to upload." },
      { status: 400, headers: noStore() },
    );
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
    return Response.json(
      { error: "Choose a valid image file to upload." },
      { status: 400, headers: noStore() },
    );

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return Response.json(
      { error: "The photo upload could not be read." },
      { status: 400, headers: noStore() },
    );
  }
  const validation = validatePlacePhotoFile({
    contentType: file.type,
    sizeBytes: file.size,
    fileName: file.name,
    bytes,
  });
  if (!validation.ok)
    return Response.json(
      { error: validation.error },
      { status: validation.status, headers: noStore() },
    );
  if (bytes.byteLength !== validation.sizeBytes)
    return Response.json(
      { error: "The photo size could not be verified." },
      { status: 400, headers: noStore() },
    );

  let repository: PlacePhotoRepository;
  try {
    repository = dependencies.repository ?? d1PlacePhotoRepository();
    if (!(await repository.hasPlace(placeId))) return notFound();
  } catch {
    return unavailable();
  }

  let bucket: R2BucketLike | null;
  try {
    bucket = await (dependencies.getBucket ?? getEvidenceBucket)();
  } catch {
    return unavailable();
  }
  if (!bucket) return unavailable();

  try {
    const decision = await (
      dependencies.consumeUploadLimits ?? consumePlacePhotoUploadLimits
    )(gate.auth.userId, getClientIp(request));
    if (!decision.allowed) return rateLimited(decision.retryAfterMs, "upload");
  } catch {
    return unavailable();
  }

  let stored: Awaited<ReturnType<typeof storePlacePhotoBytes>> | null = null;
  try {
    stored = await storePlacePhotoBytes(bucket, gate.auth.userId, bytes, validation);
    const result = await registerPlacePhotoForUser(
      repository,
      gate.auth.userId,
      placeId,
      {
        r2Key: stored.key,
        contentType: stored.contentType,
        byteSize: stored.sizeBytes,
        fileName: stored.fileName,
      },
    );
    if (!result.ok) {
      await removeObject(bucket, stored.key);
      return notFound();
    }
    return Response.json(
      { placeId, photo: photoPayload(result.photo) },
      { status: 201, headers: noStore() },
    );
  } catch {
    if (stored) await removeObject(bucket, stored.key);
    return unavailable();
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handlePlacePhotosPost(request, context);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handlePlacePhotosGet(request, context);
}
