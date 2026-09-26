import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findPlacesByCity, getCity } from "../../../src/lib/places";
import { citySlugParam, pageParam } from "@halalfood/core/params";
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
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
import { loadOrDegrade } from "../../../src/lib/load";
import { PlaceGrid, SectionTitle } from "../../../src/components/place-tile";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@halalfood/ui/components/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@halalfood/ui/components/pagination";
import { EmptyState } from "../../../src/components/blocks";
import { MapsIcon } from "@hugeicons/core-free-icons";
import ShareButton from "../../../src/components/share-button";
import { guidePath } from "../../../src/lib/guides";
import CityCoverageCard from "../../../src/components/city-coverage";
import { getCityCoverage } from "../../../src/lib/coverage-repository";
import { coverageHeadline } from "@halalfood/core/coverage";

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
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath={`/city/${encodeURIComponent(citySlug)}`} />
        </PageMain>
        <SiteFooter />
      </Page>
    );
  const city = loaded.data;
  const { places, total } = listing.data;
  if (page > 0 && !places.length) notFound();

  // Coverage is informational: if it cannot be read, the listing still renders
  // rather than the whole city page failing over one panel.
  const coverage = await getCityCoverage(city.city_slug).catch(() => null);

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
      ? `/map?city=${encodeURIComponent(city.city_slug)}`
      : "/map";

  return (
    <Page>
      <SiteHeader />
      <PageMain>
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
        <PageIntro
          title={cityTitle(city.city_slug, city.place_count)}
          lead={cityDescription(city.city_slug, city.place_count)}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <Button asChild size="xl">
              <a href={mapLink}>
                <HugeiconsIcon icon={MapsIcon} size={18} aria-hidden="true" />
                Show on map
              </a>
            </Button>
            <Button asChild size="xl" variant="outline">
              <a href={guidePath(city.city_slug)}>Read the {name} guide</a>
            </Button>
            <ShareButton
              url={path}
              title={`Halal food in ${name}`}
              text={`${formatCount(city.place_count)} halal ${plural(city.place_count, "place")} in ${name}`}
            />
          </div>
        </PageIntro>

        {coverage && (
          <CityCoverageCard
            coverage={coverage}
            headline={coverageHeadline(coverage)}
          />
        )}

        <section aria-labelledby="listings">
          <SectionTitle id="listings" className="mb-4">
            {page > 0
              ? `Places ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + places.length}`
              : `Top-rated in ${name}`}
          </SectionTitle>
          {places.length ? (
            <PlaceGrid places={places} />
          ) : (
            <EmptyState>
              No places here yet. <a href="/add">Add the first one</a>.
            </EmptyState>
          )}
        </section>

        {lastPage > 0 && (
          <Pagination className="mt-10">
            <PaginationContent>
              {page > 0 && (
                <PaginationItem>
                  <PaginationPrevious
                    href={page === 1 ? path : `${path}?page=${page - 1}`}
                    rel="prev"
                  />
                </PaginationItem>
              )}
              <PaginationItem className="px-3 text-sm font-semibold">
                Page {page + 1} of {lastPage + 1}
              </PaginationItem>
              {page < lastPage && (
                <PaginationItem>
                  <PaginationNext href={`${path}?page=${page + 1}`} rel="next" />
                </PaginationItem>
              )}
            </PaginationContent>
          </Pagination>
        )}
        <ApproximateNote />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
