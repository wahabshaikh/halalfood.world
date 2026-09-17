import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ArrowUpRight, MapPinned } from "lucide-react";
import { findPlacesByCity, getCity } from "../../../src/lib/places";
import { citySlugParam } from "../../../src/lib/params";
import {
  breadcrumbJsonLd,
  canonical,
  formatCount,
  jsonLdScript,
  OG_IMAGE,
  plural,
} from "../../../src/lib/seo";
import {
  ApproximateNote,
  Breadcrumbs,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
import { loadOrDegrade } from "../../../src/lib/load";
import { PlaceList } from "../../../src/components/place-list";
import ShareButton from "../../../src/components/share-button";
import {
  GUIDE_SELECTION_NOTE,
  guideDescription,
  guidePath,
  guideTitle,
} from "../../../src/lib/guides";

const GUIDE_PAGE_SIZE = 24;

const loadGuide = cache(async (raw: string) => {
  const slug = citySlugParam(raw);
  if (!slug) return { status: "missing" as const };
  return await loadOrDegrade(async () => {
    const city = await getCity(slug);
    if (!city) return null;
    const listing = await findPlacesByCity(slug, { limit: GUIDE_PAGE_SIZE });
    return { city, listing };
  });
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ citySlug: string }>;
}): Promise<Metadata> {
  const { citySlug } = await params;
  const loaded = await loadGuide(citySlug);
  if (loaded.status !== "ok")
    return {
      title: loaded.status === "missing" ? "Guide not found" : "Guide unavailable",
      robots: { index: false, follow: true },
    };
  const { city } = loaded.data;
  const title = guideTitle(city.city_slug);
  const description = guideDescription(city);
  return {
    title,
    description,
    alternates: { canonical: guidePath(city.city_slug) },
    openGraph: {
      type: "website",
      url: canonical(guidePath(city.city_slug)),
      title,
      description,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ citySlug: string }>;
}) {
  const { citySlug } = await params;
  const loaded = await loadGuide(citySlug);
  if (loaded.status === "missing" || (loaded.status === "ok" && !loaded.data)) notFound();
  if (loaded.status === "error")
    return (
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath={guidePath(citySlug)} />
        </main>
        <SiteFooter />
      </div>
    );

  const { city, listing } = loaded.data;
  const { places, total } = listing;
  const trail = [
    { name: "halalfood.world", path: "/" },
    { name: "Guides", path: "/guides" },
    { name: city.city_slug.replace(/-/g, " "), path: guidePath(city.city_slug) },
  ];
  const path = guidePath(city.city_slug);

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
                name: guideTitle(city.city_slug),
                url: canonical(path),
                numberOfItems: total,
                itemListElement: places.map((place, index) => ({
                  "@type": "ListItem",
                  position: index + 1,
                  url: canonical("/place/" + place.id),
                  name: place.name,
                })),
              },
              breadcrumbJsonLd(trail),
            ]),
          }}
        />
        <Breadcrumbs trail={trail} />
        <header className="page-intro guide-detail-intro">
          <p className="eyebrow">HALALFOOD.WORLD GUIDE</p>
          <h1>{guideTitle(city.city_slug)}</h1>
          <p className="lead">{guideDescription(city)}</p>
          <div className="guide-detail-meta">
            <span>{formatCount(total)} {plural(total, "place")} in this guide</span>
            {city.address_country && <span>{city.address_country}</span>}
          </div>
          <div className="detail-actions">
            <a className="action primary" href={"/?city=" + encodeURIComponent(city.city_slug)}>
              <MapPinned size={15} aria-hidden="true" />
              Open {city.city_slug.replace(/-/g, " ")} on the map
            </a>
            <ShareButton
              url={path}
              title={guideTitle(city.city_slug)}
              text={guideDescription(city)}
              className="action share-button"
            />
            <a className="action" href="/guides">
              All guides <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
          <ApproximateNote compact />
        </header>

        <section aria-labelledby="guide-places-title">
          <div className="section-bar">
            <div>
              <p className="eyebrow">START HERE</p>
              <h2 id="guide-places-title">Places to compare</h2>
            </div>
            <span className="section-bar-note">Public rating + review volume</span>
          </div>
          <p className="section-intro guide-selection-note">{GUIDE_SELECTION_NOTE}</p>
          <PlaceList places={places} />
        </section>

        <section className="guide-next-step" aria-labelledby="guide-next-step-title">
          <div>
            <p className="eyebrow">KEEP EXPLORING</p>
            <h2 id="guide-next-step-title">Check the evidence before you go.</h2>
            <p>
              Open any place to see source facts, halal verification submissions, dated
              community photos, and visit notes in one decision trail.
            </p>
          </div>
          <a className="action" href={"/?city=" + encodeURIComponent(city.city_slug)}>
            See the full map <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
