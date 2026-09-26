import {
  searchGooglePlaces,
  getGooglePlacesApiKey,
} from "../../../../src/lib/google-places";
import { getRequestAuth } from "../../../../src/lib/auth-session";
import {
  consumeGooglePlaceSearchLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../../src/lib/otp-rate-limit";
import { validateGooglePlaceQuery } from "../../../../src/lib/place-submission";
import { locationFromRequest } from "../../../../src/lib/visitor-location";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unavailable(message = "Google search is temporarily unavailable. Please try again.") {
  return Response.json(
    { error: message },
    { status: 503, headers: noStore() },
  );
}

function unauthorized() {
  return Response.json(
    {
      error: "Sign in to search Google Places.",
      loginUrl: "/login?returnTo=%2Fadd",
    },
    { status: 401, headers: noStore() },
  );
}

export async function GET(request: Request) {
  const auth = await getRequestAuth(request);
  if (auth.status === "unavailable") return unavailable();
  if (auth.status === "unauthenticated") return unauthorized();

  const query = validateGooglePlaceQuery(
    new URL(request.url).searchParams.get("q"),
  );
  if (!query.ok)
    return Response.json(
      { error: query.error },
      { status: 400, headers: noStore() },
    );
  if (!getGooglePlacesApiKey())
    return unavailable("Search is paused right now. Please try again later.");

  try {
    const decision = await consumeGooglePlaceSearchLimits(
      auth.userId,
      getClientIp(request),
    );
    if (!decision.allowed) {
      const seconds = retryAfterSeconds(decision.retryAfterMs);
      return Response.json(
        { error: "Too many Google searches. Please try again later." },
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
  } catch {
    return unavailable();
  }

  try {
    const result = await searchGooglePlaces(query.query, {
      near: locationFromRequest(request),
    });
    if (!result.ok) {
      if (result.code === "NOT_CONFIGURED")
        return unavailable("Search is paused right now. Please try again later.");
      if (result.code === "INVALID_QUERY")
        return Response.json(
          { error: result.message },
          { status: 400, headers: noStore() },
        );
      return Response.json(
        { error: "Google search didn’t work. Please try again." },
        { status: 502, headers: noStore() },
      );
    }
    return Response.json(
      {
        places: result.places.map((place) => ({
          id: place.id,
          name: place.displayName,
          address: place.formattedAddress,
        })),
      },
      { headers: noStore() },
    );
  } catch {
    return unavailable();
  }
}
