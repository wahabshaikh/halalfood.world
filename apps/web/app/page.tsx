import { redirect } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { MapsIcon } from "@hugeicons/core-free-icons";
import { findPlacesByCity } from "../src/lib/places";
import { loadOrDegrade } from "../src/lib/load";
import {
  APPROXIMATE_NOTE,
  canonical,
  cityName,
  formatCount,
  jsonLdScript,
  plural,
  SITE_NAME,
  SITE_URL,
} from "../src/lib/seo";
import {
  ExploreTabs,
  Lead,
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../src/components/site-chrome";
import { PlaceRow } from "../src/components/place-tile";
import { Button } from "@halalfood/ui/components/button";
import {
  ChipLink,
  ChipRow,
  EmptyState,
  FloatingPill,
  PromoCard,
  TextLink,
} from "../src/components/blocks";
import {
  findPlacesNear,
  loadLocalContext,
} from "../src/lib/local-context-repository";
import type { LocalContext } from "../src/lib/local-context";
import { formatDistance } from "../src/lib/visitor-location";
import { looksSignedIn } from "../src/lib/auth-session";

const ROW_CITIES = 3;
const ROW_SIZE = 12;
const CHIP_CITIES = 8;

/** Old map links used the home page (`/?place=…`); the map now lives at /map. */
const MAP_PARAMS = ["place", "city", "lat", "lng", "z"];

async function loadExplore() {
  return loadOrDegrade(async () => {
    const context = await loadLocalContext();
    const near =
      context.isLocal && context.location
        ? await findPlacesNear(context.location, { limit: ROW_SIZE }).catch(() => [])
        : [];
    const shown = new Set(near.map((place) => place.id));
    const rows = await Promise.all(
      context.cities.slice(0, ROW_CITIES).map(async (city) => ({
        city,
        places: (await findPlacesByCity(city.city_slug, { limit: ROW_SIZE + shown.size }))
          .places.filter((place) => !shown.has(place.id))
          .slice(0, ROW_SIZE),
      })),
    );
    return { context, near, rows };
  });
}

/** One short line of copy per situation, so the first screen reads in a glance. */
function heroCopy(context: LocalContext | null) {
  if (context?.isLocal && context.areaName)
    return {
      title: `Halal food near ${context.areaName}`,
      lead: "Checked by people who ate there.",
      addFirst: false,
    };
  if (context?.location && context.nearest && context.areaName) {
    const away =
      context.nearest.distance_km !== null ? formatDistance(context.nearest.distance_km) : "";
    return {
      title: "Halal food, wherever you go",
      addFirst: true,
      lead: `Nothing listed near ${context.areaName} yet. The closest city is ${cityName(
        context.nearest.city_slug,
      )}${away ? `, ${away} away` : ""}.`,
    };
  }
  return {
    addFirst: false,
    title: "Halal food you’ll love",
    lead: "Near you or wherever you travel. Checked by people who ate there.",
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const legacy = new URLSearchParams();
  for (const key of MAP_PARAMS) {
    const value = params[key];
    if (typeof value === "string") legacy.set(key, value);
  }
  if ([...legacy.keys()].length) redirect("/map?" + legacy.toString());

  const [loaded, signedIn] = await Promise.all([loadExplore(), looksSignedIn()]);
  const context = loaded.status === "ok" ? loaded.data.context : null;
  const hero = heroCopy(context);
  const area = context?.areaName ?? null;
  const addHref = "/add";

  return (
    <Page>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript([
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: SITE_URL,
              description:
                "Halal restaurants near you and anywhere you travel, with halal checks from people who ate there.",
              potentialAction: {
                "@type": "SearchAction",
                target: canonical("/search") + "?q={search_term_string}",
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "How accurate are the pins on the halalfood.world map?",
                  acceptedAnswer: { "@type": "Answer", text: APPROXIMATE_NOTE },
                },
                {
                  "@type": "Question",
                  name: "How do I know a place is halal?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Each place shows the halal checks people have shared, such as a certificate they saw, the meat supplier or whether alcohol is served, with a date on each one. We don't certify places ourselves.",
                  },
                },
              ],
            },
          ]),
        }}
      />
      <SiteHeader />
      <PageMain>
        <ExploreTabs active="eat" />
        <header className="mb-7.5 grid gap-2.5">
          <h1 className="text-[clamp(28px,4vw,42px)] leading-tight">{hero.title}</h1>
          <Lead>
            {hero.lead}{" "}
            {hero.addFirst && area && (
              <TextLink href={addHref}>Add the first place in {area}</TextLink>
            )}
          </Lead>
        </header>

        {loaded.status === "ok" ? (
          <>
            {loaded.data.context.cities.length > 0 && (
              <ChipRow
                role="navigation"
                className="mt-2 mb-9"
                aria-label={context?.location ? "Cities near you" : "Popular cities"}
              >
                {loaded.data.context.cities.slice(0, CHIP_CITIES).map((city) => (
                  <ChipLink
                    key={city.city_slug}
                    href={"/city/" + city.city_slug}
                    hint={
                      city.distance_km !== null && context?.location
                        ? formatDistance(city.distance_km)
                        : formatCount(city.place_count) + " " + plural(city.place_count, "place")
                    }
                  >
                    {cityName(city.city_slug)}
                  </ChipLink>
                ))}
                <ChipLink href="/cities">All cities</ChipLink>
              </ChipRow>
            )}
            <PlaceRow title="Closest to you" href="/map" places={loaded.data.near} />
            {loaded.data.rows.map(({ city, places }) => (
              <PlaceRow
                key={city.city_slug}
                title={"Top rated in " + cityName(city.city_slug)}
                href={"/city/" + city.city_slug}
                places={places}
              />
            ))}
            {!loaded.data.rows.length && (
              <EmptyState>
                No places are listed yet. <a href={addHref}>Add the first one</a>.
              </EmptyState>
            )}
          </>
        ) : (
          <EmptyState>
            Places are taking a moment to load. <a href="/map">Open the map</a> or try
            again shortly.
          </EmptyState>
        )}

        {signedIn ? (
          <PromoCard
            className="mt-3 mb-10"
            art="visits"
            title={area ? `Been somewhere good in ${area}?` : "Been somewhere good?"}
            description="Add it in under a minute and help the next person decide."
            action={
              <Button asChild size="xl">
                <a href={addHref}>Add a place</a>
              </Button>
            }
          />
        ) : (
          <PromoCard
            className="mt-3 mb-10"
            tone="honey"
            art="cup"
            title="Keep your favourites in one place"
            description="Save spots, build lists and track where you’ve eaten. Just your email."
            action={
              <Button asChild size="xl">
                <a href="/login?returnTo=%2Fsaved&reason=join">Join free</a>
              </Button>
            }
          />
        )}
      </PageMain>
      <FloatingPill href="/map">
        Show map <HugeiconsIcon icon={MapsIcon} size={16} aria-hidden="true" />
      </FloatingPill>
      <noscript>
        <div className="mx-auto my-10 grid max-w-3xl gap-3 px-4.5">
          <p>The map needs JavaScript. Every city and place page works without it.</p>
          <TextLink href="/cities">Browse halal food by city</TextLink>
        </div>
      </noscript>
      <SiteFooter active="explore" />
    </Page>
  );
}
