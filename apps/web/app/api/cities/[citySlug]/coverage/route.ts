import { citySlugParam } from "@halalfood/core/params";
import {
  getCityCoverage,
  requestCityCoverage,
} from "../../../../../src/lib/coverage-repository";
import { coverageHeadline } from "@halalfood/core/coverage";
import { consumeContributionLimits, getClientIp } from "../../../../../src/lib/otp-rate-limit";
import {
  INVALID_JSON,
  badRequest,
  json,
  optionalUser,
  readJson,
  unavailable,
} from "../../../../../src/lib/api";

/** Honest coverage counts for one city. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ citySlug: string }> },
): Promise<Response> {
  const citySlug = citySlugParam((await context.params).citySlug);
  if (!citySlug) return badRequest("Invalid city.");
  try {
    const coverage = await getCityCoverage(citySlug);
    return json(
      { coverage, headline: coverageHeadline(coverage) },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch {
    return unavailable();
  }
}

/**
 * Ask for deeper coverage of a city.
 *
 * Open to signed-out visitors on purpose: this is the action a launch-day
 * visitor from an unindexed city needs, and requiring an account first would
 * throw away the signal. The requester is identified by a salted hash so a
 * repeat request is de-duplicated without keeping a visitor log.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ citySlug: string }> },
): Promise<Response> {
  const citySlug = citySlugParam((await context.params).citySlug);
  if (!citySlug) return badRequest("Invalid city.");

  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const input = body as Record<string, unknown>;

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null && input.note !== "") {
    if (typeof input.note !== "string" || input.note.trim().length > 500)
      return badRequest("The note must be 500 characters or fewer.");
    note = input.note.trim() || null;
  }

  const userId = await optionalUser(request);
  const ip = getClientIp(request);

  if (userId) {
    try {
      const decision = await consumeContributionLimits(userId, ip);
      if (!decision.allowed) return badRequest("Too many requests. Try again later.");
    } catch {
      return unavailable();
    }
  }

  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`halalfood:city-request:${citySlug}:${userId ?? ip}`),
    );
    const requesterHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const result = await requestCityCoverage({
      citySlug,
      userId,
      requesterHash,
      wantsToContribute: input.wantsToContribute === true,
      note,
    });
    const coverage = await getCityCoverage(citySlug);
    return json(
      { ...result, coverage, headline: coverageHeadline(coverage) },
      { status: result.created ? 201 : 200 },
    );
  } catch {
    return unavailable();
  }
}
