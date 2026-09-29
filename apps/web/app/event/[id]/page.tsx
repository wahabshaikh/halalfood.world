import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isEventId } from "@halalfood/core/events";
import { Badge } from "@halalfood/ui/components/badge";
import { getEvent } from "../../../src/lib/events-repository";
import { loadOrDegrade } from "../../../src/lib/load";
import { canonical, cityName, jsonLdScript, plural } from "../../../src/lib/seo";
import {
  Breadcrumbs,
  Page,
  PageIntro,
  PageMain,
  SiteFooter,
  SiteHeader,
  Unavailable,
} from "../../../src/components/site-chrome";
import { LocalTime } from "../../../src/components/local-time";
import { Note } from "../../../src/components/section";
import { TONE_BADGE } from "../../../src/components/status-tone";
import EventGoing from "./event-going";

async function load(raw: string) {
  if (!isEventId(raw)) return { status: "missing" as const };
  return loadOrDegrade(() => getEvent(raw.toLowerCase()));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const loaded = await load((await params).id);
  if (loaded.status !== "ok")
    return { title: "Event not found", robots: { index: false, follow: true } };
  const event = loaded.data;
  return {
    title: event.title,
    description: `${event.title} at ${event.venue}, ${cityName(event.citySlug)}. ${event.vendorCount} ${plural(event.vendorCount, "vendor")}, each with its own halal status.`,
    alternates: { canonical: `/event/${event.id}` },
    robots: { index: !event.cancelled, follow: true },
  };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await load(id);
  if (loaded.status === "missing") notFound();
  if (loaded.status === "error")
    return (
      <Page>
        <SiteHeader />
        <PageMain>
          <Unavailable retryPath={`/event/${encodeURIComponent(id)}`} />
        </PageMain>
        <SiteFooter active="community" />
      </Page>
    );

  const event = loaded.data;
  const trail = [
    { name: "Halalfood", path: "/" },
    { name: "Events", path: "/events" },
    { name: event.title, path: `/event/${event.id}` },
  ];
  const listed = event.vendors.filter((vendor) => vendor.status.listed).length;

  return (
    <Page>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            "@context": "https://schema.org",
            "@type": "Event",
            name: event.title,
            startDate: new Date(event.startsAt).toISOString(),
            ...(event.endsAt ? { endDate: new Date(event.endsAt).toISOString() } : {}),
            eventStatus: event.cancelled
              ? "https://schema.org/EventCancelled"
              : "https://schema.org/EventScheduled",
            location: { "@type": "Place", name: event.venue, address: event.address ?? cityName(event.citySlug) },
            url: canonical(`/event/${event.id}`),
            ...(event.description ? { description: event.description } : {}),
          }),
        }}
      />
      <SiteHeader />
      <PageMain narrow>
        <Breadcrumbs trail={trail} />
        <PageIntro
          eyebrow={event.cancelled ? "CANCELLED" : event.phase === "live" ? "ON NOW" : "HALAL FOOD EVENT"}
          title={event.title}
          lead={
            <>
              <LocalTime at={event.startsAt} /> · {event.venue}, {cityName(event.citySlug)}
            </>
          }
        >
          {event.address && <Note>{event.address}</Note>}
          {event.description && <p className="max-w-2xl whitespace-pre-line">{event.description}</p>}
          <EventGoing
            eventId={event.id}
            title={event.title}
            closed={event.cancelled || event.phase === "past"}
            initialGoing={event.going}
          />
        </PageIntro>

        <section aria-labelledby="vendors-title">
          <h2 id="vendors-title" className="mb-1 text-[22px]">
            {event.vendorCount} {plural(event.vendorCount, "vendor")}
          </h2>
          {event.vendorCount > 0 && (
            <Note className="mb-3">
              {listed} of {event.vendorCount} {listed === 1 ? "is" : "are"} listed on halalfood.world with evidence. Each
              vendor shows its own status.
            </Note>
          )}
          <ul className="divide-y" data-testid="event-vendors">
            {event.vendors.map((vendor) => (
              <li key={vendor.id} className="flex items-start justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <strong className="block">
                    {vendor.placeId ? (
                      <a href={`/place/${vendor.placeId}`} className="hover:underline">
                        {vendor.name}
                      </a>
                    ) : (
                      vendor.name
                    )}
                  </strong>
                  {vendor.note && <span className="text-sm text-muted-foreground">{vendor.note}</span>}
                  {!vendor.status.listed && (
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">No listing yet</span>
                  )}
                </div>
                <Badge
                  variant={TONE_BADGE[vendor.status.tone]}
                  className="shrink-0"
                  title={vendor.status.note || undefined}
                >
                  {vendor.status.label}
                </Badge>
              </li>
            ))}
          </ul>
          {!event.vendorCount && <Note>The vendor list hasn&rsquo;t been published yet.</Note>}
          <Note className="mt-6">
            &ldquo;Unverified&rdquo; means nobody has checked that stall on halalfood.world yet. It says nothing either
            way. If you&rsquo;re there, you can <a href="/add" className="underline">add it</a> and share what you saw.
          </Note>
        </section>
      </PageMain>
      <SiteFooter active="community" />
    </Page>
  );
}
