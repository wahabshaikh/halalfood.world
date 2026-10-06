import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Location01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/hf/app-shell";
import { DateBlock, friendsLine, stallsLine } from "@/components/hf/event-bits";
import { Avatar, Icon, Page, ROW_CARD, StatusPill, TopBar } from "@/components/hf/kit";
import { LocalTime } from "@/components/hf/local-time";
import { getViewerId } from "@/lib/auth-session";
import { getEvent } from "@/lib/events";
import { isModerator } from "@/lib/moderators";
import { cityName } from "@/lib/place-view";
import { avatarUrl } from "@/lib/profiles";
import { canonical, jsonLdScript } from "@/lib/seo";
import { EventActions } from "./event-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEvent((await params).id, null).catch(() => null);
  if (!event) return { title: "Event not found", robots: { index: false } };
  return {
    title: event.title,
    description: `${event.venue}, ${cityName(event.citySlug)}. ${stallsLine(event)}.`,
    alternates: { canonical: `/event/${event.id}` },
  };
}

export default async function EventPage({ params }: Props) {
  const viewerId = await getViewerId();
  const event = await getEvent((await params).id, viewerId, { moderator: await isModerator(viewerId) });
  if (!event) notFound();
  const friends = friendsLine(event, viewerId);
  const firstUnchecked = event.stallList.find((stall) => stall.placeId && stall.status.kind !== "verified");
  return (
    <AppShell active="explore">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript([
            {
              "@context": "https://schema.org",
              "@type": "FoodEvent",
              name: event.title,
              startDate: new Date(event.startsAt).toISOString(),
              ...(event.endsAt ? { endDate: new Date(event.endsAt).toISOString() } : {}),
              eventStatus: event.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
              location: { "@type": "Place", name: event.venue, address: event.address ?? cityName(event.citySlug) },
              url: canonical(`/event/${event.id}`),
            },
          ]),
        }}
      />
      <Page>
        <TopBar back={`/events?city=${event.citySlug}`} />
        {/* Phones stack this in the order of the `order-*` classes; from lg it is the story and a sticky sidebar. */}
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-x-12">
          <div className="contents lg:grid lg:gap-8">
            <div className="flex items-start gap-4 max-lg:order-1">
              <DateBlock at={event.startsAt} />
              <div className="grid gap-1">
                <h1 className="text-[26px] leading-tight font-black tracking-tight md:text-[34px]">{event.title}</h1>
                {event.status === "cancelled" && <span className="w-fit rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-black text-destructive">Cancelled</span>}
                {event.status === "draft" && <span className="w-fit rounded-full bg-secondary px-2.5 py-0.5 text-xs font-black">Draft</span>}
              </div>
            </div>
            {event.description && <p className="text-[15px] leading-relaxed max-lg:order-3 md:text-base">{event.description}</p>}
            <section aria-labelledby="stalls" className="grid gap-2 max-lg:order-6">
              <div className="flex items-baseline justify-between">
                <h2 id="stalls" className="text-[19px] font-black md:text-xl">
                  Stalls
                </h2>
                <span className="text-[13px] font-bold text-muted-foreground">{stallsLine(event)}</span>
              </div>
              <p className="text-[13px] font-semibold text-muted-foreground">Each stall’s status comes from checks at its own place.</p>
              <ul className="grid md:grid-cols-2 md:gap-3">
                {event.stallList.map((stall) => (
                  <li key={stall.id}>
                    <a
                      href={stall.placeId ? `/place/${stall.placeId}` : "/add"}
                      className={cn("flex items-center gap-3 border-b border-border/70 py-3 text-foreground", ROW_CARD, "md:py-3.5")}
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <strong className="truncate text-[15px] font-extrabold">{stall.name}</strong>
                        {stall.note && <span className="truncate text-[13px] font-semibold text-muted-foreground">{stall.note}</span>}
                      </span>
                      <StatusPill status={stall.status} short />
                    </a>
                  </li>
                ))}
              </ul>
              {firstUnchecked && (
                <a href={`/place/${firstUnchecked.placeId}/check`} className="mt-2 w-fit text-sm font-extrabold text-foreground underline">
                  Going? Check a stall
                </a>
              )}
            </section>
          </div>

          <aside className="contents lg:sticky lg:top-24 lg:grid lg:gap-5 lg:rounded-[20px] lg:border lg:border-border lg:p-5">
            <div className="grid gap-1 text-[15px] font-semibold max-lg:order-2">
              <LocalTime at={event.startsAt} />
              <span className="flex items-center gap-1.5 text-subtle-foreground">
                <Icon icon={Location01Icon} size={16} className="shrink-0" />
                {event.venue}
                {event.address ? `, ${event.address}` : ""}
              </span>
            </div>
            {event.status === "published" && (
              <div className="max-lg:order-4">
                <EventActions eventId={event.id} title={event.title} going={event.goingByMe} signedIn={Boolean(viewerId)} />
              </div>
            )}
            {friends && (
              <div className="flex items-center gap-2.5 max-lg:order-5">
                <span className="flex">
                  {event.friends.slice(0, 4).map((friend) => (
                    <Avatar key={friend.userId} name={friend.name} seed={friend.userId} src={avatarUrl(friend.avatarKey, friend.handle)} size={28} ring className="-ml-1.5 first:ml-0" />
                  ))}
                </span>
                <span className="text-sm font-extrabold">{friends}</span>
              </div>
            )}
          </aside>
        </div>
      </Page>
    </AppShell>
  );
}
