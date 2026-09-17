import { getRequestAuth } from "../../../../../src/lib/auth-session";
import { placeIdParam } from "../../../../../src/lib/params";
import {
  consumeHalalVerificationLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../../src/lib/otp-rate-limit";
import {
  validateHalalVerificationSubmission,
  type ValidatedHalalVerification,
} from "../../../../../src/lib/halal-verification";
import {
  d1HalalVerificationRepository,
  submitHalalVerification,
  type HalalVerificationRepository,
} from "../../../../../src/lib/halal-verifications";
import {
  evidenceOwnerPrefix,
  getEvidenceBucket,
  type R2BucketLike,
} from "../../../../../src/lib/r2";
import type { RequestAuth } from "../../../../../src/lib/auth-session";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(placeId: string) {
  return Response.json(
    {
      error: "Sign in to submit halal verification evidence.",
      loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`,
    },
    { status: 401, headers: noStore() },
  );
}

function unavailable() {
  return Response.json(
    { error: "Halal verification is temporarily unavailable. Please try again." },
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

function rateLimited(retryAfterMs: number) {
  const seconds = retryAfterSeconds(retryAfterMs);
  return Response.json(
    { error: "Too many verification submissions. Please try again later." },
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

export type VerificationRouteDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  consumeLimits?: typeof consumeHalalVerificationLimits;
  repository?: HalalVerificationRepository;
  getBucket?: () => Promise<R2BucketLike | null>;
};

export async function handleVerificationPost(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: VerificationRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return invalidPlace();

  const auth = await (dependencies.getAuth ?? getRequestAuth)(request);
  if (auth.status === "unavailable") return unavailable();
  if (auth.status === "unauthenticated") return unauthorized(placeId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Send a valid JSON object." },
      { status: 400, headers: noStore() },
    );
  }
  const validation = validateHalalVerificationSubmission(body);
  if (!validation.ok)
    return Response.json(
      { error: validation.error },
      { status: 400, headers: noStore() },
    );

  const input: ValidatedHalalVerification = validation.data;
  const uploads = input.evidence.filter((item) => item.kind === "upload");
  if (uploads.length) {
    const ownerPrefix = await evidenceOwnerPrefix(auth.userId);
    if (uploads.some((item) => !item.key.startsWith(ownerPrefix)))
      return Response.json(
        { error: "That evidence upload does not belong to this account." },
        { status: 400, headers: noStore() },
      );

    const bucket = await (dependencies.getBucket ?? getEvidenceBucket)();
    if (!bucket) return unavailable();
    try {
      for (const item of uploads) {
        if (!(await bucket.head(item.key)))
          return Response.json(
            { error: "One evidence upload could not be found. Upload it again." },
            { status: 400, headers: noStore() },
          );
      }
    } catch {
      return unavailable();
    }
  }

  try {
    const decision = await (dependencies.consumeLimits ?? consumeHalalVerificationLimits)(
      auth.userId,
      getClientIp(request),
    );
    if (!decision.allowed) return rateLimited(decision.retryAfterMs);
  } catch {
    return unavailable();
  }

  try {
    const result = await submitHalalVerification(
      dependencies.repository ?? d1HalalVerificationRepository(),
      auth.userId,
      placeId,
      input,
    );
    if (!result.ok) return notFound();
    return Response.json(
      {
        id: result.verification.id,
        placeId,
        status: result.verification.status,
      },
      { status: 201, headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleVerificationPost(request, context);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return invalidPlace();
  let userId: string | null = null;
  const auth = await getRequestAuth(request);
  if (auth.status === "authenticated") userId = auth.userId;

  try {
    const repository = d1HalalVerificationRepository();
    if (!(await repository.hasPlace(placeId))) return notFound();
    return Response.json(
      { verifications: await repository.list(placeId, userId) },
      { headers: { "Cache-Control": userId ? "no-store" : "public, max-age=60" } },
    );
  } catch {
    return unavailable();
  }
}
