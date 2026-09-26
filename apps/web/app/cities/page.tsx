import type { Metadata } from "next";
import { cache } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MapsIcon } from "@hugeicons/core-free-icons";
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
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { loadOrDegrade } from "../../src/lib/load";
import { Button } from "@halalfood/ui/components/button";
import { CityCard, CityGrid, EmptyState, monogram } from "../../src/components/blocks";

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
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath="/cities" />
        </PageMain>
        <SiteFooter active="explore" />
      </Page>
    );

  const { cities, total } = loaded.data;
  const trail = [
    { name: "halalfood.world", path: "/" },
    { name: "Cities", path: "/cities" },
  ];

  return (
    <Page>
      <SiteHeader />
      <PageMain>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(breadcrumbJsonLd(trail)),
          }}
        />
        <ExploreTabs active="guides" />
        <Breadcrumbs trail={trail} />
        <PageIntro
          title={TITLE}
          lead={
            <>
              {formatCount(total)} {plural(total, "city", "cities")} and counting. Pick one to
              see its best-loved places.
            </>
          }
        >
          <div className="flex flex-wrap gap-2.5">
            <Button asChild size="xl">
              <a href="/map">
                <HugeiconsIcon icon={MapsIcon} size={18} aria-hidden="true" />
                Show the map
              </a>
            </Button>
            <Button asChild size="xl" variant="outline">
              <a href="/guides">Read city guides</a>
            </Button>
          </div>
        </PageIntro>

        {cities.length ? (
          <CityGrid>
            {cities.map((city) => (
              <li key={city.city_slug}>
                <CityCard
                  href={"/city/" + city.city_slug}
                  mark={<span aria-hidden="true">{monogram(cityName(city.city_slug))}</span>}
                  title={cityName(city.city_slug)}
                  meta={
                    <>
                      {formatCount(city.place_count)} {plural(city.place_count, "place")}
                      {city.address_country ? " · " + city.address_country : ""}
                    </>
                  }
                />
              </li>
            ))}
          </CityGrid>
        ) : (
          <EmptyState>
            No cities yet. <a href="/add">Add the first place</a>.
          </EmptyState>
        )}
      </PageMain>
      <SiteFooter active="explore" />
    </Page>
  );
}