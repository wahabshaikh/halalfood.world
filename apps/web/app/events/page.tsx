import { cache } from "react";
import type { Metadata } from "next";
import { citySlugParam } from "@halalfood/core/params";
import { listUpcomingEvents } from "../../src/lib/events-repository";
import { cachedRead } from "../../src/lib/read-cache";
import { loadOrDegrade } from "../../src/lib/load";
import { canonical, cityName, OG_IMAGE } from "../../src/lib/seo";
import {
  ExploreTabs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../src/components/site-chrome";
import { ChipLink, ChipRow, EmptyState } from "../../src/components/blocks";
import { EventCard } from "../../src/components/event-card";
import { Note } from "../../src/components/section";

const TITLE = "Halal food events";
const DESCRIPTION =
  "Iftar walks, Eid markets and food festivals, with every vendor's halal status shown on its own.";

const load = cache((citySlug: string | null) =>
  loadOrDegrade(() =>
    cachedRead(`events:page:v1:${citySlug ?? "all"}`, 120, () =>
      listUpcomingEvents({ citySlug, limit: 50 }),
    ),
  ),
);

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const city = citySlugParam(typeof (await searchParams).city === "string" ? ((await searchParams).city as string) : null);
  return {
    title: city ? `${TITLE} in ${cityName(city)}` : TITLE,
    description: DESCRIPTION,
    alternates: { canonical: city ? `/events?city=${city}` : "/events" },
    openGraph: {
      type: "website",
      url: canonical("/events"),
      title: TITLE,
      description: DESCRIPTION,
      images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
    },
  };
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).city;
  const city = citySlugParam(typeof raw === "string" ? raw : null);
  const [loaded, everywhere] = await Promise.all([load(city), city ? load(null) : Promise.resolve(null)]);
  const all = city ? everywhere : loaded;
  const cities = all?.status === "ok" ? [...new Set(all.data.map((event) => event.citySlug))] : [];

  return (
    <Page>
      <SiteHeader />
      <PageMain narrow>
        <ExploreTabs active="community" />
        <PageIntro
          title="Coming up"
          lead="Halal food events near you and wherever you travel. Every vendor carries its own status."
        />
        {cities.length > 1 && (
          <ChipRow className="mb-6" role="navigation" aria-label="Cities">
            <ChipLink href="/events" active={!city}>
              All cities
            </ChipLink>
            {cities.map((slug) => (
              <ChipLink key={slug} href={`/events?city=${slug}`} active={city === slug}>
                {cityName(slug)}
              </ChipLink>
            ))}
          </ChipRow>
        )}
        {loaded.status === "error" && <Unavailable retryPath="/events" />}
        {loaded.status === "ok" && !loaded.data.length && (
          <EmptyState>
            No events are listed yet. Check back soon, or{" "}
            <a href="/leaderboard">see what the community is up to</a>.
          </EmptyState>
        )}
        {loaded.status === "ok" && loaded.data.length > 0 && (
          <ul className="grid gap-3">
            {loaded.data.map((event) => (
              <li key={event.id}>
                <EventCard event={event} showCity={!city} />
              </li>
            ))}
          </ul>
        )}
        <Note className="mt-8">
          A festival being halal isn&rsquo;t one fact, so each vendor shows its own status. A stall we haven&rsquo;t
          listed yet shows &ldquo;Unverified&rdquo;, which only means nobody has checked it here.
        </Note>
      </PageMain>
      <SiteFooter active="community" />
    </Page>
  );
}
