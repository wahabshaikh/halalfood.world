import type { Metadata } from "next";
import { cache } from "react";
import { ArrowUpRight, BookOpen, MapPinned } from "lucide-react";
import { listCities } from "../../src/lib/places";
import {
  breadcrumbJsonLd,
  canonical,
  formatCount,
  jsonLdScript,
  OG_IMAGE,
} from "../../src/lib/seo";
import {
  ApproximateNote,
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { loadOrDegrade } from "../../src/lib/load";
import {
  GUIDE_SELECTION_NOTE,
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
    twitter: { card: "summary_large_image", title: TITLE, description },
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
        <Breadcrumbs trail={trail} />
        <header className="page-intro guides-intro">
          <div className="directory-kicker">
            <span className="ui-badge ui-badge-accent">
              <BookOpen size={12} aria-hidden="true" />
              Curated starting points
            </span>
            <span>{formatCount(cities.length)} guides available</span>
          </div>
          <p className="eyebrow">THE HALALFOOD.WORLD GUIDE</p>
          <h1>Start with a city. Leave with a better shortlist.</h1>
          <p className="lead">
            These guides turn the map’s ranked listings into a small, readable first
            step. Open a city, compare the places, then inspect the evidence yourself.
          </p>
          <div className="detail-actions">
            <a className="action primary" href="/">
              <MapPinned size={15} aria-hidden="true" />
              Open the world map
            </a>
            <a className="action" href="/cities">
              Browse every city
            </a>
          </div>
          <ApproximateNote compact />
        </header>

        <section aria-labelledby="guides-list-title">
          <div className="section-bar">
            <div>
              <p className="eyebrow">CITY SHORTLISTS</p>
              <h2 id="guides-list-title">Where to begin</h2>
            </div>
            <span className="section-bar-note">Largest directories first</span>
          </div>
          {cities.length ? (
            <ul className="guide-grid">
              {cities.map((city) => (
                <li key={city.city_slug}>
                  <a className="guide-card" href={guidePath(city.city_slug)}>
                    <span className="guide-card-mark" aria-hidden="true">
                      {cityMark(city.city_slug)}
                    </span>
                    <span className="guide-card-copy">
                      <span className="guide-card-kicker">{guideKicker(city)}</span>
                      <strong>{guideTitle(city.city_slug)}</strong>
                      <span>{guideDescription(city)}</span>
                      <small>
                        {formatCount(city.place_count)} listed{" "}
                        {city.place_count === 1 ? "place" : "places"}
                      </small>
                    </span>
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">
              Guides will appear as cities are mapped. <a href="/">Open the map</a>.
            </p>
          )}
        </section>

        <section className="guide-rubric" aria-labelledby="guide-rubric-title">
          <div>
            <p className="eyebrow">HOW TO READ A GUIDE</p>
            <h2 id="guide-rubric-title">A shortlist is a starting point, not a verdict.</h2>
          </div>
          <p>{GUIDE_SELECTION_NOTE}</p>
          <ol>
            <li><strong>Compare the public signal.</strong> Ratings and review volume help you scan quickly.</li>
            <li><strong>Check the source.</strong> Listing facts and community halal evidence stay separate.</li>
            <li><strong>Confirm before travel.</strong> Addresses are approximate and restaurants change.</li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
