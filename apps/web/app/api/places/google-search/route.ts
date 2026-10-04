import { bboxParam } from "@halalfood/core/params";
import { validateGooglePlaceQuery } from "@halalfood/core/place-submission";
import { getRequestAuth } from "../../../../src/lib/auth-session";
import { getClientIp } from "../../../../src/lib/otp-rate-limit";
import {
  googleSearchResponse,
  guardedGoogleTextSearch,
} from "../../../../src/lib/google-search-guard";
import { locationFromRequest } from "../../../../src/lib/visitor-location";

function noStore() {
  return { "Cache-Control": "no-store" };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Reject a short query before session lookup or any Google call.
  const parsed = validateGooglePlaceQuery(params.get("q"));
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400, headers: noStore() });
  }
  const rawBbox = params.get("bbox");
  let bbox: ReturnType<typeof bboxParam> | null = null;
  if (rawBbox) {
    try {
      bbox = bboxParam(rawBbox);
    } catch (error) {
      return Response.json(
        { error: (error as Error).message },
        { status: 400, headers: noStore() },
      );
    }
  }

  const auth = await getRequestAuth(request);
  const userId = auth.status === "authenticated" ? auth.userId : null;

  try {
    const result = await guardedGoogleTextSearch({
      query: parsed.query,
      userId,
      ip: getClientIp(request),
      near: locationFromRequest(request),
      bbox,
    });
    return googleSearchResponse(result);
  } catch {
    return Response.json(
      { error: "Google search is temporarily unavailable. Please try again." },
      { status: 503, headers: noStore() },
    );
  }
}
