import { citySlugParam } from "@halalfood/core/params";
import { listUpcomingEvents } from "../../../src/lib/events-repository";
import { cachedRead } from "../../../src/lib/read-cache";

const CACHE_CONTROL = "public, max-age=60, s-maxage=60";

/** Upcoming halal food events, soonest first, optionally for one city. Public. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const citySlug = citySlugParam(url.searchParams.get("city")) ?? null;
  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, 50) : 20;
  try {
    const events = await cachedRead(`events:upcoming:v1:${citySlug ?? "all"}:${limit}`, 120, () =>
      listUpcomingEvents({ citySlug, limit }),
    );
    return Response.json({ events }, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch {
    return Response.json({ error: "Events are temporarily unavailable." }, { status: 503 });
  }
}
