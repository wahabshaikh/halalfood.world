import { getRequestAuth, type RequestAuth } from "../../../../../../src/lib/auth-session";
import { placeIdParam } from "../../../../../../src/lib/params";
import {
  consumePlacePhotoMutationLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../../../src/lib/otp-rate-limit";
import {
  deletePlacePhotoForUser,
  d1PlacePhotoRepository,
  type PlacePhotoRepository,
} from "../../../../../../src/lib/place-photos";
import {
  getEvidenceBucket,
  type R2BucketLike,
} from "../../../../../../src/lib/r2";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(placeId: string) {
  return Response.json(
    {
      error: "Sign in to delete your halal place photo.",
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

function invalidPhoto() {
  return Response.json(
    { error: "Invalid photo id." },
    { status: 400, headers: noStore() },
  );
}

function photoNotFound() {
  return Response.json(
    { error: "Your halal place photo could not be found." },
    { status: 404, headers: noStore() },
  );
}

function rateLimited(retryAfterMs: number) {
  const seconds = retryAfterSeconds(retryAfterMs);
  return Response.json(
    { error: "Too many photo actions. Please try again later." },
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

type AuthenticatedRequestAuth = Extract<
  RequestAuth,
  { status: "authenticated" }
>;

export type PlacePhotoDeleteRouteDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  consumeLimits?: typeof consumePlacePhotoMutationLimits;
  repository?: PlacePhotoRepository;
  getBucket?: () => Promise<R2BucketLike | null>;
};

async function authenticate(
  request: Request,
  placeId: string,
  dependencies: PlacePhotoDeleteRouteDependencies,
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

export async function handlePlacePhotoDelete(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
  dependencies: PlacePhotoDeleteRouteDependencies = {},
): Promise<Response> {
  const rawParams = await params;
  const placeId = placeIdParam(rawParams.id);
  if (!placeId) return invalidPlace();
  const photoId = placeIdParam(rawParams.photoId);
  if (!photoId) return invalidPhoto();

  const gate = await authenticate(request, placeId, dependencies);
  if ("response" in gate) return gate.response;

  try {
    const decision = await (
      dependencies.consumeLimits ?? consumePlacePhotoMutationLimits
    )(gate.auth.userId, getClientIp(request));
    if (!decision.allowed) return rateLimited(decision.retryAfterMs);
  } catch {
    return unavailable();
  }

  try {
    const result = await deletePlacePhotoForUser(
      dependencies.repository ?? d1PlacePhotoRepository(),
      gate.auth.userId,
      placeId,
      photoId,
    );
    if (!result.ok) return photoNotFound();

    // Removing the row first makes a failed R2 cleanup fail closed: the URL is
    // no longer authorized even if the object briefly remains in the bucket.
    try {
      const bucket = await (dependencies.getBucket ?? getEvidenceBucket)();
      if (bucket && typeof bucket.delete === "function") await bucket.delete(result.r2Key);
    } catch {
      // The DB row is already gone; orphan cleanup can be handled by Ops.
    }
    return Response.json(
      { placeId, photoId, deleted: true },
      { headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; photoId: string }> },
): Promise<Response> {
  return handlePlacePhotoDelete(request, context);
}
