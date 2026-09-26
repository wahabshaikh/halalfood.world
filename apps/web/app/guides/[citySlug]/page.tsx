import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { MapsLocation01Icon } from "@hugeicons/core-free-icons";
import { findPlacesByCity, getCity } from "../../../src/lib/places";
import { citySlugParam } from "@halalfood/core/params";
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
import { PlaceGrid } from "../../../src/components/place-tile";
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
        <header className="page-intro">
          <h1>{guideTitle(city.city_slug)}</h1>
          <p className="lead">{guideDescription(city)}</p>
          <p className="muted">
            {formatCount(total)} {plural(total, "place")} in this guide
            {city.address_country ? " · " + city.address_country : ""}
          </p>
          <div className="button-row">
            <a className="btn btn-dark" href={"/map?city=" + encodeURIComponent(city.city_slug)}>
              <HugeiconsIcon icon={MapsLocation01Icon} size={18} aria-hidden="true" />
              Show on map
            </a>
            <ShareButton url={path} title={guideTitle(city.city_slug)} text={guideDescription(city)} />
          </div>
        </header>

        <section aria-labelledby="guide-places-title">
          <div className="section-head">
            <div>
              <h2 id="guide-places-title" className="section-title">
                Places to start with
              </h2>
              <p>{GUIDE_SELECTION_NOTE}</p>
            </div>
          </div>
          <PlaceGrid places={places} />
        </section>

        <section className="promo-card" style={{ marginTop: 40 }} aria-labelledby="guide-next-step-title">
          <div>
            <h2 id="guide-next-step-title">See how we know before you go</h2>
            <p>
              Every place shows its halal checks, photos and reviews, each with a date. Been
              somewhere on this list? Add your check.
            </p>
            <a className="link-underline" href={"/map?city=" + encodeURIComponent(city.city_slug)}>
              See the full map
            </a>
          </div>
        </section>
        <div style={{ marginTop: 24 }}>
          <ApproximateNote compact />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
