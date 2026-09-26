import type { Metadata } from "next";
import { Map as MapIcon } from "lucide-react";
import { findPlaces, findPlacesByCity } from "../../src/lib/places";
import {
  findPlacesNear,
  loadLocalContext,
} from "../../src/lib/local-context-repository";
import type { LocalContext } from "../../src/lib/local-context";
import { loadOrDegrade } from "../../src/lib/load";
import { cityName, formatCount, plural } from "../../src/lib/seo";
import { SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import { PlaceGrid, PlaceRow } from "../../src/components/place-tile";
import { Illustration } from "../../src/components/art";

const RESULT_LIMIT = 48;
const SUGGESTION_LIMIT = 12;

/** Something worth tapping when there's no query or no match: what's near them. */
async function suggestions(context: LocalContext) {
  if (context.isLocal && context.location) {
    const near = await findPlacesNear(context.location, { limit: SUGGESTION_LIMIT });
    if (near.length) return { title: "Closest to you", href: "/map", places: near };
  }
  const city = context.cities[0];
  if (!city) return null;
  const { places } = await findPlacesByCity(city.city_slug, { limit: SUGGESTION_LIMIT });
  return {
    title: "Top rated in " + cityName(city.city_slug),
    href: "/city/" + city.city_slug,
    places,
  };
}

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
  const loaded = await loadOrDegrade(async () => {
    const context = await loadLocalContext();
    const results = searchable
      ? await findPlaces({ q, limit: RESULT_LIMIT })
      : { places: [], total: 0, limit: RESULT_LIMIT };
    const needle = normalize(q);
    return {
      results,
      // Ranked nearest first, so "London" finds the London you mean.
      cities: searchable
        ? context.cities
            .filter((city) => normalize(cityName(city.city_slug)).includes(needle))
            .slice(0, 8)
        : [],
      suggested:
        !searchable || !results.total ? await suggestions(context).catch(() => null) : null,
    };
  });
  const suggested = loaded.status === "ok" ? loaded.data.suggested : null;

  return (
    <div className="page">
      <SiteHeader searchValue={q} />
      <main className="page-main">
        {!searchable && (
          <header className="page-intro">
            <h1>What are you craving?</h1>
            <p className="lead">Try a restaurant, a dish or a city.</p>
          </header>
        )}

        {searchable && loaded.status !== "ok" && (
          <div className="empty-panel">
            <h1>Search is taking a moment</h1>
            <p>Please try again shortly.</p>
            <a className="btn btn-dark" href={"/search?q=" + encodeURIComponent(q)}>
              Try again
            </a>
          </div>
        )}

        {searchable && loaded.status === "ok" && (
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
                <h2>Know “{q}”?</h2>
                <p>Add it in under a minute.</p>
                <a className="btn btn-primary" href={"/add?q=" + encodeURIComponent(q)}>
                  Add “{q}”
                </a>
              </div>
            )}
          </>
        )}
        {suggested && (
          <PlaceRow title={suggested.title} href={suggested.href} places={suggested.places} />
        )}
      </main>
      <a className="floating-pill" href="/map">
        Show map <MapIcon size={16} aria-hidden="true" />
      </a>
      <SiteFooter active="explore" />
    </div>
  );
}
