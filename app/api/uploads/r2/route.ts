import { getRequestAuth } from "../../../../src/lib/auth-session";
import type { RequestAuth } from "../../../../src/lib/auth-session";
import {
  consumeHalalVerificationUploadLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../src/lib/otp-rate-limit";
import { neonHalalVerificationRepository } from "../../../../src/lib/halal-verifications";
import { neonPlacePhotoRepository } from "../../../../src/lib/place-photos";
import {
  getEvidenceBucket,
  isSafeEvidenceR2Key,
  isSafePhotoR2Key,
  isSafeR2Key,
  MAX_R2_UPLOAD_BYTES,
  storeEvidenceFile,
  type R2BucketLike,
} from "../../../../src/lib/r2";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(returnTo = "/") {
  return Response.json(
    {
      error: "Sign in to upload halal verification evidence.",
      loginUrl: `/login?returnTo=${encodeURIComponent(returnTo)}`,
    },
    { status: 401, headers: noStore() },
  );
}

function unavailable() {
  return Response.json(
    { error: "Evidence uploads are temporarily unavailable. Please try again." },
    { status: 503, headers: noStore() },
  );
}

function returnTo(request: Request): string {
  const value = new URL(request.url).searchParams.get("returnTo") || "/";
  return value.startsWith("/") && !value.startsWith("//") && value.length <= 512
    ? value
    : "/";
}

function rateLimited(retryAfterMs: number) {
  const seconds = retryAfterSeconds(retryAfterMs);
  return Response.json(
    { error: "Too many evidence uploads. Please try again later." },
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

export type R2UploadRouteDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  getBucket?: () => Promise<R2BucketLike | null>;
  consumeLimits?: typeof consumeHalalVerificationUploadLimits;
};

export async function handleR2Upload(
  request: Request,
  dependencies: R2UploadRouteDependencies = {},
): Promise<Response> {
  const auth = await (dependencies.getAuth ?? getRequestAuth)(request);
  if (auth.status === "unavailable") return unavailable();
  if (auth.status === "unauthenticated") return unauthorized(returnTo(request));

  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("multipart/form-data"))
    return Response.json(
      { error: "Upload a file using multipart form data." },
      { status: 400, headers: noStore() },
    );

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_R2_UPLOAD_BYTES + 256 * 1024
  )
    return Response.json(
      { error: "Uploads must be 8 MiB or smaller." },
      { status: 413, headers: noStore() },
    );

  const bucket = await (dependencies.getBucket ?? getEvidenceBucket)();
  if (!bucket) return unavailable();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "The upload could not be read." },
      { status: 400, headers: noStore() },
    );
  }
  const value = form.get("file");
  if (!value || typeof value !== "object")
    return Response.json(
      { error: "Choose a file to upload." },
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
      { error: "Choose a valid file to upload." },
      { status: 400, headers: noStore() },
    );
  if (file.size > MAX_R2_UPLOAD_BYTES)
    return Response.json(
      { error: "Uploads must be 8 MiB or smaller." },
      { status: 413, headers: noStore() },
    );

  try {
    const decision = await (
      dependencies.consumeLimits ?? consumeHalalVerificationUploadLimits
    )(auth.userId, getClientIp(request));
    if (!decision.allowed) return rateLimited(decision.retryAfterMs);
  } catch {
    return unavailable();
  }

  try {
    const result = await storeEvidenceFile(bucket, auth.userId, {
      type: file.type,
      size: file.size,
      name: file.name,
      arrayBuffer: () => file.arrayBuffer!(),
    });
    if (!result.ok)
      return Response.json(
        { error: result.error },
        { status: result.status, headers: noStore() },
      );
    return Response.json(
      {
        key: result.key,
        contentType: result.contentType,
        sizeBytes: result.sizeBytes,
        fileName: result.fileName,
      },
      { status: 201, headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}

export async function POST(
  request: Request,
): Promise<Response> {
  return handleR2Upload(request);
}

function downloadName(value: string): string {
  return value.replace(/["\\\r\n]/g, "_").slice(0, 160);
}

export async function GET(request: Request): Promise<Response> {
  const key = new URL(request.url).searchParams.get("key");
  if (!isSafeR2Key(key))
    return Response.json({ error: "Invalid evidence key." }, { status: 400 });

  if (isSafePhotoR2Key(key)) {
    try {
      const access = await neonPlacePhotoRepository().getUploadAccess(key);
      if (!access) return new Response("Not found", { status: 404 });
      const bucket = await getEvidenceBucket();
      if (!bucket) return unavailable();
      const object = await bucket.get(key);
      if (!object?.body) return new Response("Not found", { status: 404 });
      const headers = new Headers({
        "Content-Type": access.contentType,
        "Content-Disposition": `inline; filename="${downloadName(access.fileName)}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": "public, max-age=3600",
      });
      return new Response(object.body, { headers });
    } catch {
      return unavailable();
    }
  }

  // Keep the evidence branch narrower than the shared proxy predicate so a
  // photo key can never be accepted as verification evidence metadata.
  if (!isSafeEvidenceR2Key(key))
    return Response.json({ error: "Invalid evidence key." }, { status: 400 });

  let userId: string | null = null;
  const auth = await getRequestAuth(request);
  if (auth.status === "authenticated") userId = auth.userId;

  try {
    const access = await (
      neonHalalVerificationRepository()
    ).getUploadAccess(key, userId);
    if (!access) return new Response("Not found", { status: 404 });
    const bucket = await getEvidenceBucket();
    if (!bucket) return unavailable();
    const object = await bucket.get(key);
    if (!object?.body) return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "Content-Type": access.contentType,
      "Content-Disposition": `inline; filename="${downloadName(access.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": access.status === "approved" ? "public, max-age=3600" : "no-store",
    });
    return new Response(object.body, { headers });
  } catch {
    return unavailable();
  }
}
