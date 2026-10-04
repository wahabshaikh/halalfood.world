import { slugifyCity, type ValidatedGoogleSubmission, type ValidatedLinkSubmission } from "@halalfood/core/place-submission";
import {
  GOOGLE_PLACES_ADD_FIELD_MASK,
  getGooglePlaceDetails,
  getGooglePlacesApiKey,
  googlePlaceLocality,
  googlePlaceMapsUrl,
  type GooglePlaceDetailsResult,
} from "./google-places";
import { submitPlaceLink, type LinkSubmissionResult } from "./place-link-submissions";
import { reserveGoogleDetailsCall } from "./google-search-budget";
import {
  citySlugFromAddress,
  duplicateBody,
  findExistingPlace,
  type DuplicateCandidate,
  type ExistingPlaceMatch,
} from "./place-duplicates";

const POSTCODE_AT_END =
  /(?:\s|^)(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|\d{5}(?:-\d{4})?)$/i;

/**
 * City from a formatted address when Place Details did not run.
 * "1 High Street, London, UK" and "London, United Kingdom" both yield London.
 */
export function cityFromFormattedAddress(address: string): string | null {
  const parts = address
    .split(",")
    .map((part) => part.replace(POSTCODE_AT_END, "").replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0 && part.length <= 80 && slugifyCity(part));
  if (parts.length >= 3) return parts[1];
  if (parts.length === 2) return /\d/.test(parts[0]) ? parts[1] : parts[0];
  return parts[0] ?? null;
}

/** Maps link plus the name and address the person already picked. */
export function linkFromSelectedGooglePlace(
  input: ValidatedGoogleSubmission,
): ValidatedLinkSubmission | null {
  const name = input.name?.trim() || "";
  const address = input.address?.trim() || "";
  if (!name || !address) return null;
  const city = input.city?.trim() || cityFromFormattedAddress(address);
  const citySlug = city ? slugifyCity(city) : "";
  if (!city || !citySlug) return null;
  return {
    mode: "link",
    name,
    city,
    citySlug,
    address,
    sourceUrl: googlePlaceMapsUrl(input.googlePlaceId),
    googlePlaceId: input.googlePlaceId,
    halalConfirmed: true,
  };
}

export type GooglePlaceSubmissionDeps = {
  now?: () => Date;
  reserve?: (now: Date) => Promise<boolean>;
  fetchDetails?: (
    placeId: string,
    options?: { fieldMask?: string },
  ) => Promise<GooglePlaceDetailsResult>;
  submit?: typeof submitPlaceLink;
  hasApiKey?: () => boolean;
  findExisting?: (candidate: DuplicateCandidate) => Promise<ExistingPlaceMatch | null>;
};

function noStore() {
  return { "Cache-Control": "no-store" };
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

function filedResponse(result: LinkSubmissionResult, userId: string) {
  if (!result.ok) {
    return Response.json(duplicateBody(result.match, userId), {
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
}

const CAPPED_REASON =
  "Filed from the selected Google result without a Place Details lookup. Not listed and not a halal certification.";

/**
 * Place Details for an add-place submission, counted on the details daily cap.
 * A full cap files the maps link and the picked name and address instead.
 */
export async function respondToGooglePlaceSubmission(
  userId: string,
  input: ValidatedGoogleSubmission,
  deps: GooglePlaceSubmissionDeps = {},
): Promise<Response> {
  // A place or submission we already have is refused before Place Details,
  // so a duplicate costs no Google call. submitPlaceLink checks again with
  // the name and city Google returns.
  let early: ExistingPlaceMatch | null = null;
  try {
    const address = input.address?.trim() || "";
    early = await (deps.findExisting ?? ((candidate) => findExistingPlace(candidate)))({
      googlePlaceId: input.googlePlaceId,
      name: input.name?.trim() || "",
      citySlug: input.city?.trim() ? slugifyCity(input.city) : citySlugFromAddress(address),
      address,
    });
  } catch {
    early = null;
  }
  if (early) {
    return Response.json(duplicateBody(early, userId), { status: 409, headers: noStore() });
  }

  const now = deps.now?.() ?? new Date();
  const reserve = deps.reserve ?? reserveGoogleDetailsCall;
  let allowed = false;
  try {
    allowed = await reserve(now);
  } catch {
    allowed = false;
  }

  const submit = deps.submit ?? submitPlaceLink;
  if (!allowed) {
    const link = linkFromSelectedGooglePlace(input);
    if (!link) {
      return Response.json(
        { error: "Add the place with its name and address, or try again later." },
        { status: 422, headers: noStore() },
      );
    }
    try {
      return filedResponse(await submit(userId, link, undefined, "google", CAPPED_REASON), userId);
    } catch {
      return Response.json(
        { error: "Place submissions are temporarily unavailable. Please try again." },
        { status: 503, headers: noStore() },
      );
    }
  }

  const hasApiKey = deps.hasApiKey ?? (() => Boolean(getGooglePlacesApiKey()));
  if (!hasApiKey()) {
    return Response.json(
      { error: "Adding places is paused right now. Please try again later." },
      { status: 503, headers: noStore() },
    );
  }

  let details: GooglePlaceDetailsResult;
  try {
    details = await (deps.fetchDetails ?? getGooglePlaceDetails)(input.googlePlaceId, {
      fieldMask: GOOGLE_PLACES_ADD_FIELD_MASK,
    });
  } catch {
    return googleDetailsError("NETWORK_ERROR");
  }
  if (!details.ok) return googleDetailsError(details.code);

  const name = details.place.displayName?.text?.trim();
  const address = details.place.formattedAddress?.trim();
  if (!name || !address || !details.coordinates) return googleDetailsError("INVALID_RESPONSE");
  const googlePlaceId = details.place.id?.trim() || input.googlePlaceId;
  const city = googlePlaceLocality(details.place);
  const citySlug = city ? slugifyCity(city) : "";
  if (!city || !citySlug) {
    return Response.json(
      { error: "Google doesn’t say which city this place is in, so we can’t list it yet." },
      { status: 422, headers: noStore() },
    );
  }

  try {
    return filedResponse(
      await submit(
        userId,
        {
          mode: "link",
          name,
          city,
          citySlug,
          address,
          sourceUrl: googlePlaceMapsUrl(googlePlaceId),
          googlePlaceId,
          halalConfirmed: true,
        },
        undefined,
        "google",
      ),
      userId,
    );
  } catch {
    return Response.json(
      { error: "Place submissions are temporarily unavailable. Please try again." },
      { status: 503, headers: noStore() },
    );
  }
}
