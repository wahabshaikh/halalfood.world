import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { findPlacesByCity, getCity } from "../../../src/lib/places";
import { citySlugParam, pageParam } from "../../../src/lib/params";
import {
  breadcrumbJsonLd,
  canonical,
  cityDescription,
  cityName,
  cityTitle,
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

const PAGE_SIZE = 60;

const loadCity = cache(async (raw: string) => {
  const slug = citySlugParam(raw);
  // An unparseable slug can never match a row, so do not spend a query on it.
  if (!slug) return { status: "missing" as const };
  return await loadOrDegrade(() => getCity(slug));
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ citySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { citySlug } = await params;
  const loaded = await loadCity(citySlug);
  if (loaded.status !== "ok")
    return {
      title: loaded.status === "missing" ? "City not found" : "Listings unavailable",
      robots: { index: false, follow: true },
    };
  const city = loaded.data;
  const page = pageParam((await searchParams).page);
  const title = cityTitle(city.city_slug, city.place_count);
  const description = cityDescription(city.city_slug, city.place_count);
  const path = `/city/${city.city_slug}`;
  return {
    title: page > 0 ? `${title} — page ${page + 1}` : title,
    description,
    // Paged views collapse onto page one so ranking signals stay on one URL.
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: canonical(path),
      title,
      description,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CityPage({
  params,
  searchParams,
}: {
  params: Promise<{ citySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { citySlug } = await params;
  const loaded = await loadCity(citySlug);
  if (loaded.status === "missing") notFound();

  const page = pageParam((await searchParams).page);
  const listing =
    loaded.status === "ok"
      ? await loadOrDegrade(() =>
          findPlacesByCity(loaded.data.city_slug, {
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          }),
        )
      : { status: "error" as const };
  if (loaded.status !== "ok" || listing.status !== "ok")
    return (
      <div className="page">
        <SiteHeader />
        <main className="page-main">
          <Unavailable retryPath={`/city/${encodeURIComponent(citySlug)}`} />
        </main>
        <SiteFooter />
      </div>
    );
  const city = loaded.data;
  const { places, total } = listing.data;
  if (page > 0 && !places.length) notFound();

  const name = cityName(city.city_slug);
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);
  const path = `/city/${city.city_slug}`;
  const trail = [
    { name: "halalfood.world", path: "/" },
    { name: "Cities", path: "/cities" },
    { name, path },
  ];
  const mapLink =
    city.center_lat !== null && city.center_lng !== null
      ? `/?city=${encodeURIComponent(city.city_slug)}`
      : "/";

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
                name: cityTitle(city.city_slug, city.place_count),
                url: canonical(path),
                numberOfItems: total,
                itemListElement: places.map((place, index) => ({
                  "@type": "ListItem",
                  position: page * PAGE_SIZE + index + 1,
                  url: canonical(`/place/${place.id}`),
                  name: place.name,
                })),
              },
              breadcrumbJsonLd(trail),
            ]),
          }}
        />
        <Breadcrumbs trail={trail} />
        <header className="page-intro">
          <p className="eyebrow">HALAL RESTAURANTS</p>
          <h1>{cityTitle(city.city_slug, city.place_count)}</h1>
          <p className="lead">{cityDescription(city.city_slug, city.place_count)}</p>
          <div className="detail-actions">
            <a className="action primary" href={mapLink}>
              Open {name} on the map
            </a>
            <ShareButton
              url={path}
              title={`Halal food in ${name}`}
              text={`${formatCount(city.place_count)} halal ${plural(city.place_count, "place")} in ${name}`}
              className="action share-button"
            />
          </div>
          <ApproximateNote compact />
        </header>

        <section aria-labelledby="listings">
          <h2 id="listings">
            {page > 0
              ? `Places ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + places.length}`
              : `Top-rated halal places in ${name}`}
          </h2>
          <PlaceList places={places} />
        </section>

        {lastPage > 0 && (
          <nav className="pagination" aria-label="Pagination">
            {page > 0 && (
              <a href={page === 1 ? path : `${path}?page=${page - 1}`} rel="prev">
                ← Previous
              </a>
            )}
            <span>
              Page {page + 1} of {lastPage + 1}
            </span>
            {page < lastPage && (
              <a href={`${path}?page=${page + 1}`} rel="next">
                Next →
              </a>
            )}
          </nav>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
