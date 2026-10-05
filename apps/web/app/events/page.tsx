import type { Metadata } from "next";
import { citySlugParam } from "@halalfood/core/params";
import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { AppShell } from "../../src/components/app-shell";
import { EventRow } from "../../src/components/event-bits";
import { resolveCity } from "../../src/components/explore-screen";
import { EmptyState, PageTitle, TopBar } from "../../src/components/kit";
import { getViewerId } from "../../src/lib/auth-session";
import { listEvents } from "../../src/lib/events";
import { cityName } from "../../src/lib/place-view";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const city = citySlugParam(typeof (await searchParams).city === "string" ? ((await searchParams).city as string) : null);
  return {
    title: city ? `Halal food events in ${cityName(city)}` : "Halal food events",
    description: "Iftar walks, Eid markets and food festivals, with every stall's halal status.",
    alternates: { canonical: city ? `/events?city=${city}` : "/events" },
  };
}

export default async function EventsPage({ searchParams }: Props) {
  const params = await searchParams;
  const { city } = await resolveCity(citySlugParam(typeof params.city === "string" ? params.city : null));
  const viewerId = await getViewerId();
  const events = await listEvents({ citySlug: city?.city_slug ?? null, viewerId, limit: 50 });
  const name = city ? cityName(city.city_slug) : null;
  return (
    <AppShell active="explore">
      <TopBar back={city ? `/city/${city.city_slug}` : "/"} />
      <div className="grid gap-3 px-5 pb-10">
        <PageTitle sub={name ? `What’s on in ${name}` : undefined}>Events</PageTitle>
        {events.length ? (
          <div className="grid">
            {events.map((event) => (
              <EventRow key={event.id} event={event} viewerId={viewerId} />
            ))}
          </div>
        ) : (
          <EmptyState icon={Calendar03Icon} title="No events coming up" body="Iftar walks, Eid markets and food festivals show up here." />
        )}
      </div>
    </AppShell>
  );
}
