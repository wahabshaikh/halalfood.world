import type { Metadata } from "next";
import { cache } from "react";
import { ArrowUpRight, MapPinned } from "lucide-react";
import { countCities, listCities } from "../../src/lib/places";
import {
  breadcrumbJsonLd,
  canonical,
  cityName,
  formatCount,
  jsonLdScript,
  OG_IMAGE,
  plural,
} from "../../src/lib/seo";
import {
  ApproximateNote,
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { loadOrDegrade } from "../../src/lib/load";

const TITLE = "Explore halal food by city";
const DESCRIPTION =
  "Browse every city on the Halalfood map, then open a city to see its halal restaurants, addresses, ratings and contact details.";

const loadDirectory = cache(() =>
  loadOrDegrade(async () => {
    const [cities, total] = await Promise.all([
      listCities({ limit: 1000 }),
      countCities(),
    ]);
    return { cities, total };
  }),
);

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await loadDirectory();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/cities" },
    robots: loaded.status === "ok" ? undefined : { index: false, follow: true },
    openGraph: {
      type: "website",
      url: canonical("/cities"),
      title: TITLE,
      description: DESCRIPTION,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

export default async function CitiesPage() {
  const loaded = await loadDirectory();
  if (loaded.status !== "ok")
    return (
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath="/cities" />
        </main>
        <SiteFooter />
      </div>
    );

  const { cities, total } = loaded.data;
  const trail = [
    { name: "halalfood.world", path: "/" },
    { name: "Cities", path: "/cities" },
  ];

  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(breadcrumbJsonLd(trail)),
          }}
        />
        <Breadcrumbs trail={trail} />
        <header className="page-intro directory-intro">
          <div className="directory-kicker">
            <span className="ui-badge ui-badge-default">
              <MapPinned size={12} aria-hidden="true" />
              Global directory
            </span>
            <span>{formatCount(total)} cities mapped</span>
          </div>
          <p className="eyebrow">EXPLORE BY CITY</p>
          <h1>{TITLE}</h1>
          <p className="lead">
            Start with a city, find a table, then help the next person make a more
            confident choice.
          </p>
          <div className="detail-actions">
            <a className="action primary" href="/">
              Open the world map <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <a className="action" href="/guides">
              Read city guides
            </a>
          </div>
          <ApproximateNote compact />
        </header>

        {cities.length ? (
          <section aria-labelledby="city-list-title">
            <div className="section-bar">
              <div>
                <p className="eyebrow">PLACES TO START</p>
                <h2 id="city-list-title">Cities with the most listings</h2>
              </div>
              <span className="section-bar-note">Sorted by places listed</span>
            </div>
            <ul className="city-grid">
              {cities.map((city) => (
                <li key={city.city_slug}>
                  <a href={"/city/" + city.city_slug}>
                    <strong>{cityName(city.city_slug)}</strong>
                    <small>
                      {formatCount(city.place_count)} {plural(city.place_count, "place")}
                      {city.address_country ? " · " + city.address_country : ""}
                    </small>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="empty-state">
            The city directory is empty right now. <a href="/">Try the map</a>.
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}