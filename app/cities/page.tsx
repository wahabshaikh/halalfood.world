import type { Metadata } from "next";
import { cache } from "react";
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

const TITLE = "Halal food by city";
const DESCRIPTION =
  "Every city on the Halalfood map, ordered by how many halal restaurants we list. Pick a city to see addresses, ratings and phone numbers.";

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
    // Never let an outage page collect indexing signals.
    robots: loaded.status === "ok" ? undefined : { index: false, follow: true },
    openGraph: {
      type: "website",
      url: canonical("/cities"),
      title: TITLE,
      description: DESCRIPTION,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
    },
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
    { name: "Halalfood", path: "/" },
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
        <header className="page-intro">
          <p className="eyebrow">DIRECTORY</p>
          <h1>{TITLE}</h1>
          <p className="lead">
            {total > 0
              ? `${formatCount(total)} ${plural(total, "city", "cities")} with halal listings, biggest first.`
              : DESCRIPTION}
          </p>
          <ApproximateNote compact />
        </header>

        {cities.length ? (
          <ul className="city-grid">
            {cities.map((city) => (
              <li key={city.city_slug}>
                <a href={`/city/${city.city_slug}`}>
                  <strong>{cityName(city.city_slug)}</strong>
                  <small>
                    {formatCount(city.place_count)}{" "}
                    {plural(city.place_count, "place")}
                    {city.address_country ? ` · ${city.address_country}` : ""}
                  </small>
                </a>
              </li>
            ))}
          </ul>
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
