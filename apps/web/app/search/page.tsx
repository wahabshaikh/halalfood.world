import type { Metadata } from "next";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@halalfood/ui/components/button";
import { ChipLink, ChipRow, FloatingPill } from "../../src/components/blocks";
import { MapsIcon } from "@hugeicons/core-free-icons";
import { findPlaces, findPlacesByCity } from "../../src/lib/places";
import {
  findPlacesNear,
  loadLocalContext,
} from "../../src/lib/local-context-repository";
import type { LocalContext } from "../../src/lib/local-context";
import { loadOrDegrade } from "../../src/lib/load";
import { cityName, formatCount, plural } from "../../src/lib/seo";
import {
  EmptyPanel,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../../src/components/site-chrome";
import { PlaceGrid, PlaceRow } from "../../src/components/place-tile";

const RESULT_LIMIT = 48;
const SUGGESTION_LIMIT = 12;

/** Something worth tapping when there's no query or no match: what's near them. */
async function suggestions(context: LocalContext) {
  if (context.isLocal && context.location) {
    const near = await findPlacesNear(context.location, { limit: SUGGESTION_LIMIT });
    if (near.length) return { title: "Closest to you", href: "/map", places: near };
  }
  const city = context.cities[0];
  if (!city) return null;
  const { places } = await findPlacesByCity(city.city_slug, { limit: SUGGESTION_LIMIT });
  return {
    title: "Top rated in " + cityName(city.city_slug),
    href: "/city/" + city.city_slug,
    places,
  };
}

export const metadata: Metadata = {
  title: "Search",
  description: "Search halal places and cities on halalfood.world.",
  alternates: { canonical: "/search" },
  // Result pages are thin, query-shaped duplicates of city and place pages.
  robots: { index: false, follow: true },
};

function queryParam(value: string | string[] | undefined) {
  const raw = typeof value === "string" ? value : "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = queryParam((await searchParams).q);
  const searchable = q.length >= 2;
  const loaded = await loadOrDegrade(async () => {
    const context = await loadLocalContext();
    const results = searchable
      ? await findPlaces({ q, limit: RESULT_LIMIT })
      : { places: [], total: 0, limit: RESULT_LIMIT };
    const needle = normalize(q);
    return {
      results,
      // Ranked nearest first, so "London" finds the London you mean.
      cities: searchable
        ? context.cities
            .filter((city) => normalize(cityName(city.city_slug)).includes(needle))
            .slice(0, 8)
        : [],
      suggested:
        !searchable || !results.total ? await suggestions(context).catch(() => null) : null,
    };
  });
  const suggested = loaded.status === "ok" ? loaded.data.suggested : null;

  return (
    <Page>
      <SiteHeader searchValue={q} />
      <PageMain>
        {!searchable && (
          <PageIntro title="What are you craving?" lead="Try a restaurant, a dish or a city." />
        )}

        {searchable && loaded.status !== "ok" && (
          <EmptyPanel
            art={null}
            title="Search is taking a moment"
            description="Please try again shortly."
          >
            <Button asChild size="xl">
              <a href={"/search?q=" + encodeURIComponent(q)}>Try again</a>
            </Button>
          </EmptyPanel>
        )}

        {searchable && loaded.status === "ok" && (
          <>
            <div className="mb-5 grid gap-1">
              <h1 className="text-[clamp(24px,3vw,32px)] leading-tight">Halal places matching “{q}”</h1>
              <p className="text-muted-foreground">
                  {loaded.data.results.total
                    ? formatCount(loaded.data.results.total) +
                      " " +
                      plural(loaded.data.results.total, "place") +
                      (loaded.data.results.total > RESULT_LIMIT
                        ? ` · showing the top ${RESULT_LIMIT}`
                        : "")
                    : "No places found yet"}
              </p>
            </div>

            {loaded.data.cities.length > 0 && (
              <ChipRow role="navigation" className="mt-2 mb-9" aria-label="Matching cities">
                {loaded.data.cities.map((city) => (
                  <ChipLink
                    key={city.city_slug}
                    href={"/city/" + city.city_slug}
                    hint={`${formatCount(city.place_count)} ${plural(city.place_count, "place")}`}
                  >
                    {cityName(city.city_slug)}
                  </ChipLink>
                ))}
              </ChipRow>
            )}

            {loaded.data.results.places.length ? (
              <PlaceGrid places={loaded.data.results.places} />
            ) : (
              <EmptyPanel
                art="visits"
                titleAs="h2"
                title={`Know “${q}”?`}
                description="Add it in under a minute."
              >
                <Button asChild size="xl">
                  <a href={"/add?q=" + encodeURIComponent(q)}>Add “{q}”</a>
                </Button>
              </EmptyPanel>
            )}
          </>
        )}
        {suggested && (
          <PlaceRow title={suggested.title} href={suggested.href} places={suggested.places} />
        )}
      </PageMain>
      <FloatingPill href="/map">
        Show map <HugeiconsIcon icon={MapsIcon} size={16} aria-hidden="true" />
      </FloatingPill>
      <SiteFooter active="explore" />
    </Page>
  );
}
