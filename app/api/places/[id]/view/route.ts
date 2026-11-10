import { json } from "@/lib/api";
import { placeIdParam } from "@/lib/core/params";
import { placeListed, recordPlaceView } from "@/lib/owner-claims";
import { consumePlaceViewLimits, getClientIp } from "@/lib/otp-rate-limit";

type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

function quiet(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}

/**
 * Count one place-page view. One IP can add one view per place per day.
 * Nothing about the visitor is stored. Bots and prefetches are ignored.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const placeId = placeIdParam((await params).id);
  if (!placeId) return json({ error: "That place could not be found." }, { status: 404 });
  const agent = request.headers.get("user-agent") ?? "";
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  if (/bot|spider|crawler|headless/i.test(agent) || purpose === "prefetch") return quiet();
  try {
    const decision = await consumePlaceViewLimits(placeId, getClientIp(request));
    if (!decision.allowed) return quiet();
    if (!(await placeListed(placeId))) return json({ error: "That place could not be found." }, { status: 404 });
    await recordPlaceView(placeId);
    return quiet();
  } catch {
    return quiet();
  }
}
