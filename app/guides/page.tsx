import type { Metadata } from "next";
import { cache } from "react";
import { Map as MapIcon } from "lucide-react";
import { listCities } from "../../src/lib/places";
import {
  breadcrumbJsonLd,
  canonical,
  formatCount,
  jsonLdScript,
  OG_IMAGE,
} from "../../src/lib/seo";
import {
  Breadcrumbs,
  ExploreTabs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { loadOrDegrade } from "../../src/lib/load";
import {
  guideDescription,
  guideKicker,
  guidePath,
  guideTitle,
} from "../../src/lib/guides";

const TITLE = "Halal food guides";
const DESCRIPTION =
  "Practical city guides for finding halal food, with ranked starting points, source details and community evidence.";

const loadGuides = cache(() =>
  loadOrDegrade(() => listCities({ limit: 24 })),
);

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/guides" },
    openGraph: {
      type: "website",
      url: canonical("/guides"),
      title: TITLE,
      description: DESCRIPTION,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

function cityMark(citySlug: string) {
  const words = citySlug.split("-").filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "HF"
  );
}

export default async function GuidesPage() {
  const loaded = await loadGuides();
  if (loaded.status !== "ok")
    return (
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath="/guides" />
        </main>
        <SiteFooter />
      </div>
    );

  const cities = loaded.data;
  const trail = [
    { name: "halalfood.world", path: "/" },
    { name: "Guides", path: "/guides" },
  ];
  const guideItems = cities.map((city, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: canonical(guidePath(city.city_slug)),
    name: guideTitle(city.city_slug),
  }));

  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript([
              {
                "@context": "https://schema.org",
                "@type": "ItemList",
                name: TITLE,
                url: canonical("/guides"),
                numberOfItems: guideItems.length,
                itemListElement: guideItems,
              },
              breadcrumbJsonLd(trail),
            ]),
          }}
        />
        <ExploreTabs active="guides" />
        <Breadcrumbs trail={trail} />
        <header className="page-intro">
          <h1>City guides</h1>
          <p className="lead">
            A short list of places to start with in each city. Open one, compare, then see how
            we know each place is halal.
          </p>
          <div className="button-row">
            <a className="btn btn-dark" href="/map">
              <MapIcon size={18} aria-hidden="true" />
              Show the map
            </a>
            <a className="btn btn-line" href="/cities">
              Every city
            </a>
          </div>
        </header>
        {cities.length ? (
          <ul className="city-grid">
            {cities.map((city) => (
              <li key={city.city_slug}>
                <a className="city-card" href={guidePath(city.city_slug)}>
                  <span className="city-card-mark" aria-hidden="true">
                    {cityMark(city.city_slug)}
                  </span>
                  <span>
                    <strong>{guideTitle(city.city_slug)}</strong>
                    <small>
                      {formatCount(city.place_count)} {city.place_count === 1 ? "place" : "places"} ·{" "}
                      {guideKicker(city)}
                    </small>
                    <p>{guideDescription(city)}</p>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">
            No guides yet. <a href="/map">Explore the map</a>.
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
