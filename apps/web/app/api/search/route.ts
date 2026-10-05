import { citySlugParam } from "@halalfood/core/params";
import { optionalUser, unavailable } from "../../../src/lib/api";
import { decoratePlaces } from "../../../src/lib/explore";
import { searchCities, searchPlaces } from "../../../src/lib/places";
import { normalizeSearchQuery } from "../../../src/lib/search-query";
import { searchLists, searchPeople } from "../../../src/lib/search-social";

/** One search across places, people, lists and cities, 5 of each (spec §5.1). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = normalizeSearchQuery(params.get("q") ?? "");
  if (!q) return Response.json({ q, places: [], people: [], lists: [], cities: [] });
  try {
    const viewerId = await optionalUser(request);
    const city = citySlugParam(params.get("city"));
    const [places, people, lists, cities] = await Promise.all([
      searchPlaces(q, { limit: 5, citySlug: city }),
      searchPeople(q, viewerId, 5),
      searchLists(q, viewerId, 5),
      searchCities(q, 5),
    ]);
    return Response.json(
      { q, places: await decoratePlaces(viewerId, places), people, lists, cities },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return unavailable("Search is temporarily unavailable. Please try again.");
  }
}
