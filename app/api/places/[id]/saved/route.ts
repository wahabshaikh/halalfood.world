import { getRequestAuth } from "../../../../../src/lib/auth-session";
import { placeIdParam } from "../../../../../src/lib/params";
import {
  consumeSavePlaceLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../../src/lib/otp-rate-limit";
import {
  neonSavedPlaceRepository,
  savePlaceForUser,
  unsavePlaceForUser,
} from "../../../../../src/lib/saved-places";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(placeId: string) {
  return Response.json(
    {
      error: "Sign in to save places.",
      loginUrl: `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`,
    },
    { status: 401, headers: noStore() },
  );
}

function unavailable() {
  return Response.json(
    { error: "Saved places are temporarily unavailable. Please try again." },
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
    { error: "Too many save actions. Please try again later." },
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

type AuthenticatedRequestAuth = { status: "authenticated"; userId: string };
type AuthLimitResult =
  | { response: Response }
  | { auth: AuthenticatedRequestAuth };

async function authenticateAndLimit(
  request: Request,
  placeId: string,
): Promise<AuthLimitResult> {
  const auth = await getRequestAuth(request);
  if (auth.status !== "authenticated") {
    return {
      response:
        auth.status === "unauthenticated"
          ? unauthorized(placeId)
          : unavailable(),
    };
  }

  try {
    const decision = await consumeSavePlaceLimits(
      auth.userId,
      getClientIp(request),
    );
    if (!decision.allowed)
      return { response: rateLimited(decision.retryAfterMs) };
  } catch {
    return { response: unavailable() };
  }

  return { auth };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rawId = (await params).id;
  const placeId = placeIdParam(rawId);
  if (!placeId) return invalidPlace();
  const gate = await authenticateAndLimit(request, placeId);
  if ("response" in gate) return gate.response;

  try {
    const result = await savePlaceForUser(
      neonSavedPlaceRepository(),
      gate.auth.userId,
      placeId,
    );
    if (!result.ok) return notFound();
    return Response.json(
      { placeId, saved: result.saved },
      { headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rawId = (await params).id;
  const placeId = placeIdParam(rawId);
  if (!placeId) return invalidPlace();
  const gate = await authenticateAndLimit(request, placeId);
  if ("response" in gate) return gate.response;

  try {
    const result = await unsavePlaceForUser(
      neonSavedPlaceRepository(),
      gate.auth.userId,
      placeId,
    );
    if (!result.ok) return notFound();
    return Response.json(
      { placeId, saved: result.saved },
      { headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}
