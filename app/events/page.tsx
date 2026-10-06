import type { Metadata } from "next";
import { citySlugParam } from "@/lib/core/params";
import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { AppShell } from "@/components/hf/app-shell";
import { EventRow } from "@/components/hf/event-bits";
import { resolveCity } from "@/components/hf/explore-screen";
import { EmptyState, Page, PageTitle, TopBar } from "@/components/hf/kit";
import { getViewerId } from "@/lib/auth-session";
import { listEvents } from "@/lib/events";
import { cityName } from "@/lib/place-view";

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
      <Page>
        <TopBar back={city ? `/city/${city.city_slug}` : "/"} />
        <div className="grid gap-3 md:gap-6">
        <PageTitle sub={name ? `What’s on in ${name}` : undefined}>Events</PageTitle>
        {events.length ? (
          <div className="grid md:grid-cols-2 md:gap-4">
            {events.map((event) => (
              <EventRow key={event.id} event={event} viewerId={viewerId} />
            ))}
          </div>
        ) : (
          <EmptyState icon={Calendar03Icon} title="No events coming up" body="Iftar walks, Eid markets and food festivals show up here." />
        )}
        </div>
      </Page>
    </AppShell>
  );
}
