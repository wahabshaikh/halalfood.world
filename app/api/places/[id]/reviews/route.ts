import { getRequestAuth, type RequestAuth } from "../../../../../src/lib/auth-session";
import { placeIdParam } from "../../../../../src/lib/params";
import {
  consumePlaceReviewLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../../src/lib/otp-rate-limit";
import {
  PLACE_REVIEW_MAX_PAYLOAD_BYTES,
  deletePlaceReviewForUser,
  d1PlaceReviewRepository,
  savePlaceReviewForUser,
  validatePlaceReviewInput,
  type PlaceReviewRepository,
} from "../../../../../src/lib/place-reviews";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(placeId: string) {
  return Response.json(
    {
      error: "Sign in to share a halal review.",
      loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`,
    },
    { status: 401, headers: noStore() },
  );
}

function unavailable() {
  return Response.json(
    { error: "Halal reviews are temporarily unavailable. Please try again." },
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

function reviewNotFound() {
  return Response.json(
    { error: "Your halal review could not be found." },
    { status: 404, headers: noStore() },
  );
}

function rateLimited(retryAfterMs: number) {
  const seconds = retryAfterSeconds(retryAfterMs);
  return Response.json(
    { error: "Too many review actions. Please try again later." },
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

function payloadTooLarge() {
  return Response.json(
    { error: "Review request is too large." },
    { status: 413, headers: noStore() },
  );
}

function invalidJson() {
  return Response.json(
    { error: "Send a valid JSON object." },
    { status: 400, headers: noStore() },
  );
}

async function readReviewBody(request: Request): Promise<unknown | Response> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > PLACE_REVIEW_MAX_PAYLOAD_BYTES
  )
    return payloadTooLarge();

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return invalidJson();
  }
  if (new TextEncoder().encode(raw).byteLength > PLACE_REVIEW_MAX_PAYLOAD_BYTES)
    return payloadTooLarge();
  try {
    return JSON.parse(raw);
  } catch {
    return invalidJson();
  }
}

export type ReviewRouteDependencies = {
  getAuth?: (request: Request) => Promise<RequestAuth>;
  consumeLimits?: typeof consumePlaceReviewLimits;
  repository?: PlaceReviewRepository;
};

async function authenticate(
  request: Request,
  placeId: string,
  dependencies: ReviewRouteDependencies,
): Promise<{ auth: Extract<RequestAuth, { status: "authenticated" }> } | { response: Response }> {
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

async function consumeMutationLimit(
  request: Request,
  auth: Extract<RequestAuth, { status: "authenticated" }>,
  dependencies: ReviewRouteDependencies,
): Promise<Response | null> {
  try {
    const decision = await (dependencies.consumeLimits ?? consumePlaceReviewLimits)(
      auth.userId,
      getClientIp(request),
    );
    return decision.allowed ? null : rateLimited(decision.retryAfterMs);
  } catch {
    return unavailable();
  }
}

export async function handleReviewGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: ReviewRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return invalidPlace();

  let auth: RequestAuth;
  try {
    auth = await (dependencies.getAuth ?? getRequestAuth)(request);
  } catch {
    auth = { status: "unavailable" };
  }
  const userId = auth.status === "authenticated" ? auth.userId : null;

  try {
    const repository = dependencies.repository ?? d1PlaceReviewRepository();
    if (!(await repository.hasPlace(placeId))) return notFound();
    return Response.json(
      { placeId, reviews: await repository.list(placeId, userId) },
      { headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}

export async function handleReviewPut(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: ReviewRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return invalidPlace();

  const gate = await authenticate(request, placeId, dependencies);
  if ("response" in gate) return gate.response;

  const body = await readReviewBody(request);
  if (body instanceof Response) return body;
  const validation = validatePlaceReviewInput(body);
  if (!validation.ok)
    return Response.json(
      { error: validation.error },
      { status: 400, headers: noStore() },
    );

  const limited = await consumeMutationLimit(request, gate.auth, dependencies);
  if (limited) return limited;

  try {
    const result = await savePlaceReviewForUser(
      dependencies.repository ?? d1PlaceReviewRepository(),
      gate.auth.userId,
      placeId,
      validation.data,
    );
    if (!result.ok) return notFound();
    return Response.json(
      { placeId, review: validation.data },
      { headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}

export async function handleReviewDelete(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: ReviewRouteDependencies = {},
): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return invalidPlace();

  const gate = await authenticate(request, placeId, dependencies);
  if ("response" in gate) return gate.response;

  const limited = await consumeMutationLimit(request, gate.auth, dependencies);
  if (limited) return limited;

  try {
    const result = await deletePlaceReviewForUser(
      dependencies.repository ?? d1PlaceReviewRepository(),
      gate.auth.userId,
      placeId,
    );
    if (!result.ok) return reviewNotFound();
    return Response.json({ placeId, deleted: true }, { headers: noStore() });
  } catch {
    return unavailable();
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleReviewGet(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleReviewPut(request, context);
}

/** POST is accepted as a convenient equivalent for clients that cannot send PUT. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleReviewPut(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleReviewDelete(request, context);
}
