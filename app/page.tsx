import { redirect } from "next/navigation";
import { Map as MapIcon } from "lucide-react";
import { findPlacesByCity, listCities } from "../src/lib/places";
import { loadOrDegrade } from "../src/lib/load";
import {
  APPROXIMATE_NOTE,
  canonical,
  cityName,
  formatCount,
  jsonLdScript,
  plural,
  SITE_NAME,
  SITE_URL,
} from "../src/lib/seo";
import {
  ExploreTabs,
  SiteFooter,
  SiteHeader,
} from "../src/components/site-chrome";
import { PlaceRow } from "../src/components/place-tile";
import { Illustration } from "../src/components/art";

const ROW_CITIES = 4;
const ROW_SIZE = 12;

/** Old map links used the home page (`/?place=…`); the map now lives at /map. */
const MAP_PARAMS = ["place", "city", "lat", "lng", "z"];

async function loadExplore() {
  return loadOrDegrade(async () => {
    const cities = await listCities({ limit: 10 });
    const rows = await Promise.all(
      cities.slice(0, ROW_CITIES).map(async (city) => ({
        city,
        places: (await findPlacesByCity(city.city_slug, { limit: ROW_SIZE })).places,
      })),
    );
    return { cities, rows };
  });
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const legacy = new URLSearchParams();
  for (const key of MAP_PARAMS) {
    const value = params[key];
    if (typeof value === "string") legacy.set(key, value);
  }
  if ([...legacy.keys()].length) redirect("/map?" + legacy.toString());

  const loaded = await loadExplore();

  return (
    <div className="page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript([
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: SITE_URL,
              description:
                "Halal restaurants near you and anywhere you travel, with halal checks from people who ate there.",
              potentialAction: {
                "@type": "SearchAction",
                target: canonical("/search") + "?q={search_term_string}",
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "How accurate are the pins on the halalfood.world map?",
                  acceptedAnswer: { "@type": "Answer", text: APPROXIMATE_NOTE },
                },
                {
                  "@type": "Question",
                  name: "How do I know a place is halal?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Each place shows the halal checks people have shared, such as a certificate they saw, the meat supplier or whether alcohol is served, with a date on each one. We don't certify places ourselves.",
                  },
                },
              ],
            },
          ]),
        }}
      />
      <SiteHeader />
      <main className="page-main">
        <ExploreTabs active="eat" />
        <header className="explore-hero">
          <h1>Halal food you’ll love, checked by people like you.</h1>
          <p className="lead">
            Find somewhere good near you or wherever you’re travelling. Every halal check
            has a name and a date, so you can see how we know.
          </p>
        </header>

        {loaded.status === "ok" ? (
          <>
            {loaded.data.cities.length > 0 && (
              <nav className="city-chips" aria-label="Popular cities">
                {loaded.data.cities.map((city) => (
                  <a className="chip" key={city.city_slug} href={"/city/" + city.city_slug}>
                    {cityName(city.city_slug)}
                    <small>
                      {formatCount(city.place_count)} {plural(city.place_count, "place")}
                    </small>
                  </a>
                ))}
                <a className="chip" href="/cities">
                  All cities
                </a>
              </nav>
            )}
            {loaded.data.rows.map(({ city, places }) => (
              <PlaceRow
                key={city.city_slug}
                title={"Loved in " + cityName(city.city_slug)}
                href={"/city/" + city.city_slug}
                places={places}
              />
            ))}
            {!loaded.data.rows.length && (
              <p className="empty-state">
                No places are listed yet. <a href="/add">Add the first one</a>.
              </p>
            )}
          </>
        ) : (
          <p className="empty-state">
            Places are taking a moment to load. <a href="/map">Open the map</a> or try
            again shortly.
          </p>
        )}

        <div className="promo-grid">
          <section className="promo-card">
            <Illustration name="visits" size={96} />
            <div>
              <h2>Been somewhere good?</h2>
              <p>Pick it from Google Maps and answer a few quick questions. It takes a minute.</p>
              <a className="link-underline" href="/add">
                Add a place
              </a>
            </div>
          </section>
          <section className="promo-card is-honey">
            <Illustration name="cup" size={96} />
            <div>
              <h2>Join the community</h2>
              <p>Check places when you eat there and help the next person decide.</p>
              <a className="link-underline" href="/leaderboard">
                See who’s helping
              </a>
            </div>
          </section>
        </div>
      </main>
      <a className="floating-pill" href="/map">
        Show map <MapIcon size={16} aria-hidden="true" />
      </a>
      <noscript>
        <div className="noscript-fallback">
          <p>The map needs JavaScript. Every city and place page works without it.</p>
          <a href="/cities">Browse halal food by city</a>
        </div>
      </noscript>
      <SiteFooter active="explore" />
    </div>
  );
}
