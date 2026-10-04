import { findPlaces } from "../../../../src/lib/places";
import { domainFailure } from "../../../../src/lib/domain-error";
import { normalizeSearchQuery } from "../../../../src/lib/text-search";
import { limitParam } from "@halalfood/core/params";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Any length is a normal search: the query is trimmed and capped at
  // SEARCH_QUERY_MAX_CHARS characters (text-search.ts), never refused for length.
  const q = normalizeSearchQuery(params.get("q") ?? "");
  let limit;
  try {
    limit = limitParam(params.get("limit"), 40);
    if (Array.from(q).length < 2) throw new Error("Search must contain at least 2 characters");
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    return Response.json(await findPlaces({ q, limit }), {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  } catch (error) {
    // Only a real backend failure lands here. It is logged with a reference.
    return domainFailure("Search", error);
  }
}
