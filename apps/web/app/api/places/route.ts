import { findPlaces } from "../../../src/lib/places";
import { submitPlaceLink } from "../../../src/lib/place-link-submissions";
import { duplicateBody } from "../../../src/lib/place-duplicates";
import { respondToGooglePlaceSubmission } from "../../../src/lib/google-place-submission";
import { bboxParam, limitParam } from "@halalfood/core/params";
import { getRequestAuth } from "../../../src/lib/auth-session";
import {
  consumePlaceSubmissionLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../src/lib/otp-rate-limit";
import { validatePlaceSubmission } from "@halalfood/core/place-submission";
import { signedOutLoginPath, hasSessionCookie } from "../../../src/lib/signed-out";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized(hadSession: boolean) {
  return Response.json(
    {
      error: "Sign in to add a place.",
      loginUrl: signedOutLoginPath("/add", hadSession),
    },
    { status: 401, headers: noStore() },
  );
}

function unavailable() {
  return Response.json(
    { error: "Place submissions are temporarily unavailable. Please try again." },
    { status: 503, headers: noStore() },
  );
}

function rateLimited(retryAfterMs: number) {
  const seconds = retryAfterSeconds(retryAfterMs);
  return Response.json(
    { error: "Too many place submissions. Please try again later." },
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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let bbox, limit;
  try {
    bbox = bboxParam(params.get("bbox"));
    limit = limitParam(params.get("limit"));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    return Response.json(await findPlaces({ bbox, limit }), {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60" },
    });
  } catch {
    return Response.json(
      { error: "Places are temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await getRequestAuth(request);
  if (auth.status === "unavailable") return unavailable();
  if (auth.status === "unauthenticated") return unauthorized(hasSessionCookie(request));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Send a valid JSON object." },
      { status: 400, headers: noStore() },
    );
  }
  const validation = validatePlaceSubmission(body);
  if (!validation.ok)
    return Response.json(
      { error: validation.error },
      { status: 400, headers: noStore() },
    );

  try {
    const decision = await consumePlaceSubmissionLimits(
      auth.userId,
      getClientIp(request),
    );
    if (!decision.allowed) return rateLimited(decision.retryAfterMs);
  } catch {
    return unavailable();
  }

  const input = validation.data;
  if (input.mode === "link") {
    try {
      const result = await submitPlaceLink(auth.userId, input);
      if (!result.ok) {
        return Response.json(duplicateBody(result.match, auth.userId), {
          status: 409,
          headers: noStore(),
        });
      }
      return Response.json(
        {
          id: result.id,
          status: result.status,
          deduped: result.deduped,
          listed: false,
        },
        { status: result.deduped ? 200 : 201, headers: noStore() },
      );
    } catch {
      return unavailable();
    }
  }

  return respondToGooglePlaceSubmission(auth.userId, input);
}
