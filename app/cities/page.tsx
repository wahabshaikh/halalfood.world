import type { Metadata } from "next";
import { cache } from "react";
import { Map as MapIcon } from "lucide-react";
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
  Breadcrumbs,
  ExploreTabs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { loadOrDegrade } from "../../src/lib/load";

const TITLE = "Halal food by city";
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
        <SiteFooter active="explore" />
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
        <ExploreTabs active="guides" />
        <Breadcrumbs trail={trail} />
        <header className="page-intro">
          <h1>{TITLE}</h1>
          <p className="lead">
            {formatCount(total)} {plural(total, "city", "cities")} and counting. Pick one to see
            its best-loved places.
          </p>
          <div className="button-row">
            <a className="btn btn-dark" href="/map">
              <MapIcon size={18} aria-hidden="true" />
              Show the map
            </a>
            <a className="btn btn-line" href="/guides">
              Read city guides
            </a>
          </div>
        </header>

        {cities.length ? (
          <ul className="city-grid">
            {cities.map((city) => (
              <li key={city.city_slug}>
                <a className="city-card" href={"/city/" + city.city_slug}>
                  <span className="city-card-mark" aria-hidden="true">
                    {cityName(city.city_slug)
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((word) => word[0]?.toUpperCase() ?? "")
                      .join("")}
                  </span>
                  <span>
                    <strong>{cityName(city.city_slug)}</strong>
                    <small>
                      {formatCount(city.place_count)} {plural(city.place_count, "place")}
                      {city.address_country ? " · " + city.address_country : ""}
                    </small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">
            No cities yet. <a href="/add">Add the first place</a>.
          </p>
        )}
      </main>
      <SiteFooter active="explore" />
    </div>
  );
}