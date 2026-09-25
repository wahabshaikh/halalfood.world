import { createPlace, findPlaces } from "../../../src/lib/places";
import { bboxParam, limitParam } from "../../../src/lib/params";
import {
  GOOGLE_PLACES_ADD_FIELD_MASK,
  getGooglePlaceDetails,
  getGooglePlacesApiKey,
  googlePlaceLocality,
  googlePlaceMapsUrl,
} from "../../../src/lib/google-places";
import { getRequestAuth } from "../../../src/lib/auth-session";
import {
  consumePlaceSubmissionLimits,
  getClientIp,
  retryAfterSeconds,
} from "../../../src/lib/otp-rate-limit";
import { canonical } from "../../../src/lib/seo";
import { slugifyCity, validatePlaceSubmission } from "../../../src/lib/place-submission";

function noStore() {
  return { "Cache-Control": "no-store" };
}

function unauthorized() {
  return Response.json(
    {
      error: "Sign in to add a place.",
      loginUrl: "/login?returnTo=%2Fadd",
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

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  return (
    value.code === "23505" ||
    (typeof value.message === "string" &&
      /duplicate key|unique constraint/i.test(value.message))
  );
}

function googleDetailsError(code: string) {
  if (code === "NOT_CONFIGURED") {
    return Response.json(
      { error: "Adding places is paused right now. Please try again later." },
      { status: 503, headers: noStore() },
    );
  }
  if (code === "INVALID_RESPONSE") {
    return Response.json(
      { error: "Google didn’t return enough details for that place. Try another result." },
      { status: 422, headers: noStore() },
    );
  }
  return Response.json(
    { error: "Google couldn’t confirm that place. Please try again." },
    { status: 502, headers: noStore() },
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
      headers: { "Cache-Control": "public, max-age=30" },
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
  if (auth.status === "unauthenticated") return unauthorized();

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
  if (!getGooglePlacesApiKey()) {
    return Response.json(
      { error: "Adding places is paused right now. Please try again later." },
      { status: 503, headers: noStore() },
    );
  }
  let details;
  try {
    details = await getGooglePlaceDetails(input.googlePlaceId, {
      fieldMask: GOOGLE_PLACES_ADD_FIELD_MASK,
    });
  } catch {
    return googleDetailsError("NETWORK_ERROR");
  }
  if (!details.ok) return googleDetailsError(details.code);

  const name = details.place.displayName?.text?.trim();
  const address = details.place.formattedAddress?.trim();
  if (!name || !address || !details.coordinates) {
    return googleDetailsError("INVALID_RESPONSE");
  }
  const googlePlaceId = details.place.id?.trim() || input.googlePlaceId;
  const { lat, lng } = details.coordinates;
  const city = googlePlaceLocality(details.place);
  const citySlug = city ? slugifyCity(city) : "";
  if (!city || !citySlug)
    return Response.json(
      { error: "Google doesn’t say which city this place is in, so we can’t list it yet." },
      { status: 422, headers: noStore() },
    );

  const mapsUrl = googlePlaceId ? googlePlaceMapsUrl(googlePlaceId) : null;
  try {
    const created = await createPlace({
      name,
      citySlug,
      cityUrl: canonical(`/city/${citySlug}`),
      streetAddress: address,
      addressLocality: city,
      mapsUrl,
      googlePlaceId,
      sourceUrl: mapsUrl || canonical("/add"),
      lat,
      lng,
      submittedByUserId: auth.userId,
      halalConfirmed: input.halalConfirmed,
    });
    return Response.json(
      { id: created.id, url: `/place/${created.id}` },
      { status: 201, headers: noStore() },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json(
        { error: "That place is already listed." },
        { status: 409, headers: noStore() },
      );
    }
    return unavailable();
  }
}
