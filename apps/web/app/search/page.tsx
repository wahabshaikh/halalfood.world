import type { Metadata } from "next";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@halalfood/ui/components/button";
import { ChipLink, ChipRow, FloatingPill } from "../../src/components/blocks";
import { ListCards } from "../../src/components/list-card";
import { PersonAvatar } from "../../src/components/person";
import { Badge } from "@halalfood/ui/components/badge";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@halalfood/ui/components/item";
import { avatarUrl } from "@halalfood/core/social";
import { getViewerId } from "../../src/lib/auth-session";
import { searchLists } from "../../src/lib/lists-repository";
import { searchPeople } from "../../src/lib/social-repository";
import { MapsIcon } from "@hugeicons/core-free-icons";
import { findPlaces, findPlacesByCity } from "../../src/lib/places";
import { annotateCardEvidence } from "../../src/lib/discovery";
import { readEatingCityCookie } from "../../src/lib/eating-city";
import { loadLocalContext } from "../../src/lib/local-context-repository";
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
async function suggestions(context: LocalContext, eatingSlug: string | null) {
  if (eatingSlug) {
    const { places } = await findPlacesByCity(eatingSlug, { limit: SUGGESTION_LIMIT });
    return {
      title: "Places listed in " + cityName(eatingSlug),
      href: "/city/" + eatingSlug,
      places: await annotateCardEvidence(places),
    };
  }
  const city = context.cities[0];
  if (!city) return null;
  const { places } = await findPlacesByCity(city.city_slug, { limit: SUGGESTION_LIMIT });
  return {
    title: "Places listed in " + cityName(city.city_slug),
    href: "/city/" + city.city_slug,
    places: await annotateCardEvidence(places),
  };
}

export const metadata: Metadata = {
  title: "Search",
  description: "Search halal places and cities on halalfood.world.",
  alternates: { canonical: "/search" },
  // Result pages are thin, query-shaped duplicates of city and place pages.
  robots: { index: false, follow: true },
};

const TABS = ["places", "people", "lists"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { places: "Places", people: "People", lists: "Lists" };

function tabParam(value: string | string[] | undefined): Tab {
  return TABS.find((tab) => tab === value) ?? "places";
}

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
  const query = await searchParams;
  const q = queryParam(query.q);
  const tab = tabParam(query.tab);
  const searchable = q.length >= 2;

  // People and lists depend on who is asking (blocks, private accounts), so
  // they are read per viewer and never cached. Places stay shared.
  if (tab !== "places") {
    const social = await loadOrDegrade(async () => {
      const viewerId = await getViewerId();
      return tab === "people"
        ? { people: searchable ? await searchPeople(q, viewerId) : [], lists: [] }
        : { people: [], lists: searchable || !q ? await searchLists(q, viewerId) : [] };
    });
    return (
      <Page>
        <SiteHeader searchValue={q} />
        <PageMain>
          <SearchTabs q={q} active={tab} />
          {social.status !== "ok" ? (
            <EmptyPanel
              art={null}
              title="Search is taking a moment"
              description="Please try again shortly."
            >
              <Button asChild size="xl">
                <a href={`/search?tab=${tab}&q=${encodeURIComponent(q)}`}>Try again</a>
              </Button>
            </EmptyPanel>
          ) : tab === "people" ? (
            <PeopleResults q={q} searchable={searchable} people={social.data.people} />
          ) : (
            <ListResults q={q} searchable={searchable} lists={social.data.lists} />
          )}
        </PageMain>
        <SiteFooter active="explore" />
      </Page>
    );
  }

  const eatingSlug = await readEatingCityCookie();
  const loaded = await loadOrDegrade(async () => {
    const context = await loadLocalContext();
    const found = searchable
      ? await findPlaces({ q, limit: RESULT_LIMIT })
      : { places: [], total: 0, limit: RESULT_LIMIT };
    const results = {
      ...found,
      places: await annotateCardEvidence(found.places),
    };
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
        !searchable || !results.total
          ? await suggestions(context, eatingSlug).catch(() => null)
          : null,
    };
  });
  const suggested = loaded.status === "ok" ? loaded.data.suggested : null;

  return (
    <Page>
      <SiteHeader searchValue={q} />
      <PageMain>
        <SearchTabs q={q} active="places" />
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

function SearchTabs({ q, active }: { q: string; active: Tab }) {
  return (
    <ChipRow role="navigation" className="mb-6" aria-label="What to search">
      {TABS.map((tab) => (
        <ChipLink
          key={tab}
          active={tab === active}
          href={`/search?${tab === "places" ? "" : `tab=${tab}&`}q=${encodeURIComponent(q)}`}
        >
          {TAB_LABEL[tab]}
        </ChipLink>
      ))}
    </ChipRow>
  );
}

function PeopleResults({
  q,
  searchable,
  people,
}: {
  q: string;
  searchable: boolean;
  people: Awaited<ReturnType<typeof searchPeople>>;
}) {
  if (!searchable)
    return <PageIntro title="Find friends with good taste" lead="Search by name or @handle." />;
  if (!people.length)
    return (
      <EmptyPanel
        art="visits"
        titleAs="h2"
        title={`No diners match “${q}”`}
        description="Try their @handle, or invite them from your profile."
      />
    );
  return (
    <>
      <h1 className="mb-4 text-[clamp(24px,3vw,32px)] leading-tight">People matching “{q}”</h1>
      <ItemGroup className="gap-2">
        {people.map((person) => {
          const name = person.displayName ?? person.handle;
          return (
            <Item key={person.userId} asChild variant="outline" className="rounded-xl">
              <a href={`/u/${person.handle}`}>
                <ItemMedia>
                  <PersonAvatar name={name} avatarUrl={avatarUrl(person.handle, person.avatarKey)} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="font-bold">{name}</ItemTitle>
                  <ItemDescription>@{person.handle}</ItemDescription>
                </ItemContent>
                {person.isPrivate && <Badge variant="muted">Private</Badge>}
              </a>
            </Item>
          );
        })}
      </ItemGroup>
    </>
  );
}

function ListResults({
  q,
  searchable,
  lists,
}: {
  q: string;
  searchable: boolean;
  lists: Awaited<ReturnType<typeof searchLists>>;
}) {
  if (!lists.length)
    return (
      <EmptyPanel
        art="visits"
        titleAs="h2"
        title={searchable ? `No lists match “${q}”` : "No lists yet"}
        description="Start one for your city, a dish or an Eid dinner."
      >
        <Button asChild size="xl">
          <a href="/lists">Start a list</a>
        </Button>
      </EmptyPanel>
    );
  return (
    <>
      <h1 className="mb-1 text-[clamp(24px,3vw,32px)] leading-tight">
        {searchable ? <>Lists matching “{q}”</> : "Popular lists"}
      </h1>
      <p className="mb-4 text-muted-foreground">
        Collections by diners, most saved first. Saves are taste, not a halal verdict.
      </p>
      <ListCards lists={lists} />
    </>
  );
}
