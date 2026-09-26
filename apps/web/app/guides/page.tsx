import type { Metadata } from "next";
import { cache } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@halalfood/ui/components/button";
import { CityCard, CityGrid, EmptyState } from "../../src/components/blocks";
import { MapsIcon } from "@hugeicons/core-free-icons";
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
  Page,
  PageIntro,
  PageMain,
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
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath="/guides" />
        </PageMain>
        <SiteFooter />
      </Page>
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
        <PageIntro
          title="City guides"
          lead="A short list of places to start with in each city. Open one, compare, then see how we know each place is halal."
        >
          <div className="flex flex-wrap gap-2.5">
            <Button asChild size="xl">
              <a href="/map">
                <HugeiconsIcon icon={MapsIcon} size={18} aria-hidden="true" />
                Show the map
              </a>
            </Button>
            <Button asChild size="xl" variant="outline">
              <a href="/cities">Every city</a>
            </Button>
          </div>
        </PageIntro>
        {cities.length ? (
          <CityGrid>
            {cities.map((city) => (
              <li key={city.city_slug}>
                <CityCard
                  href={guidePath(city.city_slug)}
                  mark={<span aria-hidden="true">{cityMark(city.city_slug)}</span>}
                  title={guideTitle(city.city_slug)}
                  meta={
                    <>
                      {formatCount(city.place_count)} {city.place_count === 1 ? "place" : "places"} ·{" "}
                      {guideKicker(city)}
                    </>
                  }
                  description={guideDescription(city)}
                />
              </li>
            ))}
          </CityGrid>
        ) : (
          <EmptyState>
            No guides yet. <a href="/map">Explore the map</a>.
          </EmptyState>
        )}
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
