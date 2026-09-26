import { getRequestAuth, type RequestAuth } from "../../../../../src/lib/auth-session";
import { placeIdParam } from "@halalfood/core/params";
import {
  consumePlaceRatingLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../../src/lib/otp-rate-limit";
import {
  d1PlaceRatingRepository,
  ratePlaceForUser,
  validatePlaceRatingInput,
  type PlaceRatingRepository,
  type PlaceRatingSnapshot,
} from "../../../../../src/lib/place-ratings";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(placeId: string) {
  return Response.json(
    {
      error: "Sign in to rate halal places.",
      loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`,
    },
    { status: 401, headers: noStore() },
  );
}

function unavailable() {
  return Response.json(
    { error: "Place ratings are temporarily unavailable. Please try again." },
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
    { error: "Too many rating actions. Please try again later." },
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

function ratingPayload(placeId: string, snapshot: PlaceRatingSnapshot) {
  return {
    placeId,
    rating: snapshot.currentRating,
    counts: snapshot.counts,
  };
}

export type RatingRouteDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  consumeLimits?: typeof consumePlaceRatingLimits;
  repository?: PlaceRatingRepository;
};

export async function handleRatingGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: RatingRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return invalidPlace();

  const auth = await (dependencies.getAuth ?? getRequestAuth)(request);
  const userId = auth.status === "authenticated" ? auth.userId : null;

  try {
    const snapshot = await (dependencies.repository ?? d1PlaceRatingRepository()).get(
      placeId,
      userId,
    );
    if (!snapshot) return notFound();
    return Response.json(ratingPayload(placeId, snapshot), {
      headers: userId ? noStore() : { "Cache-Control": "public, max-age=60" },
    });
  } catch {
    return unavailable();
  }
}

export async function handleRatingPut(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: RatingRouteDependencies = {},
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
  const validation = validatePlaceRatingInput(body);
  if (!validation.ok)
    return Response.json(
      { error: validation.error },
      { status: 400, headers: noStore() },
    );

  try {
    const decision = await (dependencies.consumeLimits ?? consumePlaceRatingLimits)(
      auth.userId,
      getClientIp(request),
    );
    if (!decision.allowed) return rateLimited(decision.retryAfterMs);
  } catch {
    return unavailable();
  }

  try {
    const result = await ratePlaceForUser(
      dependencies.repository ?? d1PlaceRatingRepository(),
      auth.userId,
      placeId,
      validation.data.rating,
    );
    if (!result.ok) return notFound();
    return Response.json(ratingPayload(placeId, result.snapshot), {
      headers: noStore(),
    });
  } catch {
    return unavailable();
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRatingGet(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRatingPut(request, context);
}

/** POST is accepted as a convenient equivalent for clients that cannot send PUT. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRatingPut(request, context);
}
