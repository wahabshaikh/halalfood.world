import type { Metadata } from "next";
import { Map as MapIcon } from "lucide-react";
import { findPlaces, listCities } from "../../src/lib/places";
import { loadOrDegrade } from "../../src/lib/load";
import { cityName, formatCount, plural } from "../../src/lib/seo";
import { SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import { PlaceGrid } from "../../src/components/place-tile";
import { Illustration } from "../../src/components/art";

const RESULT_LIMIT = 48;

export const metadata: Metadata = {
  title: "Search",
  description: "Search halal places and cities on halalfood.world.",
  alternates: { canonical: "/search" },
  // Result pages are thin, query-shaped duplicates of city and place pages.
  robots: { index: false, follow: true },
};

function queryParam(value: string | string[] | undefined) {
  const raw = typeof value === "string" ? value : "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = queryParam((await searchParams).q);
  const searchable = q.length >= 2;
  const loaded = searchable
    ? await loadOrDegrade(async () => {
        const [results, cities] = await Promise.all([
          findPlaces({ q, limit: RESULT_LIMIT }),
          listCities({ limit: 2000 }),
        ]);
        const needle = normalize(q);
        return {
          results,
          cities: cities
            .filter((city) => normalize(cityName(city.city_slug)).includes(needle))
            .slice(0, 8),
        };
      })
    : null;

  return (
    <div className="page">
      <SiteHeader searchValue={q} />
      <main className="page-main">
        {!searchable && (
          <div className="empty-panel">
            <Illustration name="eat" size={72} />
            <h1>What are you craving?</h1>
            <p>Search for a restaurant, a dish in its name, or a city.</p>
            <div className="button-row">
              <a className="btn btn-dark" href="/cities">
                Browse cities
              </a>
              <a className="btn btn-outline" href="/map">
                Open the map
              </a>
            </div>
          </div>
        )}

        {loaded && loaded.status !== "ok" && (
          <div className="empty-panel">
            <h1>Search is taking a moment</h1>
            <p>Please try again shortly.</p>
            <a className="btn btn-dark" href={"/search?q=" + encodeURIComponent(q)}>
              Try again
            </a>
          </div>
        )}

        {loaded?.status === "ok" && (
          <>
            <div className="results-head">
              <div>
                <h1>Halal places matching “{q}”</h1>
                <p>
                  {loaded.data.results.total
                    ? formatCount(loaded.data.results.total) +
                      " " +
                      plural(loaded.data.results.total, "place") +
                      (loaded.data.results.total > RESULT_LIMIT
                        ? ` · showing the top ${RESULT_LIMIT}`
                        : "")
                    : "No places found yet"}
                </p>
              </div>
            </div>

            {loaded.data.cities.length > 0 && (
              <nav className="city-chips" aria-label="Matching cities">
                {loaded.data.cities.map((city) => (
                  <a className="chip" key={city.city_slug} href={"/city/" + city.city_slug}>
                    {cityName(city.city_slug)}
                    <small>
                      {formatCount(city.place_count)} {plural(city.place_count, "place")}
                    </small>
                  </a>
                ))}
              </nav>
            )}

            {loaded.data.results.places.length ? (
              <PlaceGrid places={loaded.data.results.places} />
            ) : (
              <div className="empty-panel">
                <Illustration name="visits" size={72} />
                <h2>Nothing here yet</h2>
                <p>
                  Know a halal place called “{q}”? Pick it from Google Maps and we’ll add it.
                </p>
                <a className="btn btn-primary" href="/add">
                  Add a place
                </a>
              </div>
            )}
          </>
        )}
      </main>
      <a className="floating-pill" href="/map">
        Show map <MapIcon size={16} aria-hidden="true" />
      </a>
      <SiteFooter active="explore" />
    </div>
  );
}
