import { redirect } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { MapsIcon } from "@hugeicons/core-free-icons";
import { findPlacesByCity, listCities } from "../src/lib/places";
import { annotateCardEvidence } from "../src/lib/discovery";
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
  Lead,
  Page,
  PageMain,
  SiteFooter,
  SiteHeader,
} from "../src/components/site-chrome";
import { PlaceRow, PlaceTile } from "../src/components/place-tile";
import { HomeTabs } from "../src/components/home-tabs";
import { ComingUpRow, WeeklyLeaderboardRow } from "../src/components/community-rows";
import { listUpcomingEvents } from "../src/lib/events-repository";
import { listRankedDiners } from "../src/lib/diner-leaderboard";
import { cachedRead } from "../src/lib/read-cache";
import { Button } from "@halalfood/ui/components/button";
import {
  ChipLink,
  ChipRow,
  EmptyState,
  FloatingPill,
  PromoCard,
  TextLink,
} from "../src/components/blocks";
import { loadLocalContext } from "../src/lib/local-context-repository";
import { looksSignedIn } from "../src/lib/auth-session";
import { formatDistance } from "../src/lib/visitor-location";
import { homePickerCities, readEatingCityCookie, resolveEatingCity } from "../src/lib/eating-city";
import { EatingCityForm } from "../src/components/eating-city-form";

const ROW_CITIES = 3;
const ROW_SIZE = 12;
const CHIP_CITIES = 8;

/** Old map links used the home page (`/?place=…`); the map now lives at /map. */
const MAP_PARAMS = ["place", "city", "lat", "lng", "z"];

async function loadExplore(eatingSlug: string | null) {
  return loadOrDegrade(async () => {
    const context = await loadLocalContext();
    const eating = resolveEatingCity({
      cookie: eatingSlug,
      cities: context.cities,
    });
    const focusSlug =
      eating.slug ?? context.cities[0]?.city_slug ?? null;
    const focusPlaces = focusSlug
      ? await annotateCardEvidence(
          (await findPlacesByCity(focusSlug, { limit: ROW_SIZE })).places,
        )
      : [];
    const rowCities = context.cities
      .filter((city) => city.city_slug !== focusSlug)
      .slice(0, ROW_CITIES);
    const rows = await Promise.all(
      rowCities.map(async (city) => ({
        city,
        places: await annotateCardEvidence(
          (await findPlacesByCity(city.city_slug, { limit: ROW_SIZE })).places,
        ),
      })),
    );
    return { context, eating, focusSlug, focusPlaces, rows };
  });
}

/**
 * The community rails under the For you tab. Both are the same for every
 * visitor and cached briefly, and either failing just hides its rail.
 */
async function loadCommunityRails(citySlug: string | null) {
  const [events, diners] = await Promise.all([
    (citySlug
      ? listUpcomingEvents({ citySlug, limit: 6 })
      : cachedRead("events:home:v1", 120, () => listUpcomingEvents({ limit: 6 }))
    ).catch(() => []),
    listRankedDiners("week")
      .then((ranked) => ranked.slice(0, 4))
      .catch(() => []),
  ]);
  return { events, diners };
}

/** The first screen names the community. A network city is never the headline. */
function heroCopy(eatingSlug: string | null) {
  if (eatingSlug) {
    const name = cityName(eatingSlug);
    return {
      title: `Places listed in ${name}`,
      lead: `People who ate in ${name} can share what they saw. A listing is not a halal certification.`,
    };
  }
  return {
    title: "A community map of places people eat",
    lead: "People who eat halal food share what they saw: a certificate, the meat, whether alcohol is served, and the date. Halalfood lists places. It does not certify them.",
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

  const eatingCookie = await readEatingCityCookie();
  const [loaded, directory] = await Promise.all([
    loadExplore(eatingCookie),
    listCities({ limit: 500 }).catch(() => []),
  ]);
  const pickerCities = homePickerCities(
    loaded.status === "ok" ? loaded.data.context.cities : null,
    directory,
  );
  const eatingSlug =
    loaded.status === "ok"
      ? loaded.data.eating.slug
      : resolveEatingCity({ cookie: eatingCookie, cities: directory }).slug;
  const [signedIn, rails] = await Promise.all([
    looksSignedIn(),
    loadCommunityRails(eatingSlug),
  ]);
  const context = loaded.status === "ok" ? loaded.data.context : null;
  const hero = heroCopy(eatingSlug);
  const area = eatingSlug ? cityName(eatingSlug) : null;
  const addHref = "/add";
  const mapHref = eatingSlug ? `/map?city=${encodeURIComponent(eatingSlug)}` : "/map";
  const recommendation =
    loaded.status === "ok" ? (loaded.data.focusPlaces[0] ?? null) : null;

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
                "Places listed by the halalfood.world community, with dated evidence. A listing is not a halal certification.",
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
        <header className="mb-6 grid gap-2.5">
          <h1 className="text-[clamp(28px,4vw,42px)] leading-tight">{hero.title}</h1>
          <Lead>{hero.lead}</Lead>
        </header>
        <EatingCityForm
          cities={pickerCities}
          selected={eatingSlug}
          networkLabel={
            loaded.status === "ok"
              ? (context?.location?.city ?? context?.areaName ?? null)
              : null
          }
        />
        {recommendation && loaded.status === "ok" && loaded.data.focusSlug && (
          <section className="mb-8 grid gap-3" aria-label="A place you can open now">
            <h2 className="text-[22px] font-extrabold tracking-tight">
              {eatingSlug ? "Open a place in this city" : "Open a listed place"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Listed in {cityName(loaded.data.focusSlug)}. Indexing it is not a halal certification.
              {!eatingSlug && " Choose a city above before treating this as where you are eating."}
            </p>
            <div className="max-w-xs">
              <PlaceTile place={recommendation} />
            </div>
          </section>
        )}
        <HomeTabs active="for-you" />

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
            <ComingUpRow
              events={rails.events}
              href={eatingSlug ? `/events?city=${encodeURIComponent(eatingSlug)}` : "/events"}
            />
            {eatingSlug && !rails.events.length && (
              <p className="mb-9 text-sm text-muted-foreground">
                No events are listed in {cityName(eatingSlug)}.
              </p>
            )}
            {loaded.data.focusSlug && loaded.data.focusPlaces.length > 0 && (
              <PlaceRow
                title={"Places listed in " + cityName(loaded.data.focusSlug)}
                href={"/city/" + loaded.data.focusSlug}
                places={loaded.data.focusPlaces}
              />
            )}
            <WeeklyLeaderboardRow diners={rails.diners} />
            {!rails.diners.length && (
              <p className="mb-9 text-sm text-muted-foreground">
                No verified visits are ranked this week.
              </p>
            )}
            {loaded.data.rows.map(({ city, places }) => (
              <PlaceRow
                key={city.city_slug}
                title={"Places listed in " + cityName(city.city_slug)}
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
      <FloatingPill href={mapHref}>
        {eatingSlug ? `Map of ${area}` : "Show map"}{" "}
        <HugeiconsIcon icon={MapsIcon} size={16} aria-hidden="true" />
      </FloatingPill>
      <noscript>
        <div className="mx-auto my-10 grid max-w-3xl gap-3 px-4.5">
          <p>The map needs JavaScript. Every city and place page works without it.</p>
          <TextLink href="/cities">Browse places by city</TextLink>
        </div>
      </noscript>
      <SiteFooter active="explore" />
    </Page>
  );
}
