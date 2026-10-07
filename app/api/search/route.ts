import { citySlugParam } from "@/lib/core/params";
import { optionalUser, unavailable } from "@/lib/api";
import { decoratePlaces } from "@/lib/explore";
import { searchCities, searchPlaces } from "@/lib/places";
import { avatarUrl } from "@/lib/profiles";
import { normalizeSearchQuery } from "@/lib/search-query";
import { searchLists, searchPeople } from "@/lib/search-social";

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
      {
        q,
        places: await decoratePlaces(viewerId, places),
        people: people.map((person) => ({ ...person, avatarUrl: avatarUrl(person.avatarKey, person.handle) })),
        lists,
        cities,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return unavailable("Search is temporarily unavailable. Please try again.");
  }
}
