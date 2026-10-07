import { listEvents } from "@/lib/events";
import { exploreLists } from "@/lib/lists";
import { photoUrl } from "@/lib/place-view";
import { DateBlock, stallsLine } from "./event-bits";
import { PlaceArt, SectionTitle } from "./kit";

/**
 * The rows above the place list on Explore: events this week and guides &
 * lists for the city. Each row hides itself when empty.
 */
/** A scrolling row that bleeds to the screen edge on phones and becomes a grid from md. */
const ROW = "-mx-5 flex gap-3 overflow-x-auto px-5 [scrollbar-width:none] md:mx-0 md:grid md:gap-4 md:overflow-visible md:px-0";

export async function ExploreExtras({ citySlug, cityLabel, viewerId }: { citySlug: string; cityLabel: string; viewerId: string | null }) {
  const [events, lists] = await Promise.all([
    listEvents({ citySlug, viewerId, limit: 5, withinDays: 7 }).catch(() => []),
    exploreLists(citySlug).catch(() => []),
  ]);
  return (
    <>
      {events.length > 0 && (
        <section aria-labelledby="events-title" className="grid gap-2.5 md:gap-4">
          <SectionTitle
            id="events-title"
            action={
              <a href={`/events?city=${citySlug}`} className="text-sm font-extrabold text-foreground">
                See all
              </a>
            }
          >
            This week in {cityLabel}
          </SectionTitle>
          <div className={ROW + " md:grid-cols-2 lg:grid-cols-3"}>
            {events.map((event) => (
              <a
                key={event.id}
                href={`/event/${event.id}`}
                className="flex w-64 shrink-0 gap-3 rounded-2xl border border-border p-3 text-foreground md:w-auto md:p-4 md:hover:bg-muted"
              >
                <DateBlock at={event.startsAt} />
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-[15px] font-extrabold">{event.title}</strong>
                  <span className="truncate text-xs font-semibold text-muted-foreground">{event.venue}</span>
                  <span className="text-xs font-bold text-success">{stallsLine(event)}</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
      {lists.length > 0 && (
        <section aria-labelledby="guides-title" className="grid gap-2.5 md:gap-4">
          <SectionTitle id="guides-title">Guides & lists</SectionTitle>
          <div className={ROW + " md:grid-cols-3 lg:grid-cols-6"}>
            {lists.map((list) => (
              <a key={list.id} href={`/list/${list.id}`} className="grid w-44 shrink-0 content-start gap-1.5 text-foreground md:w-auto">
                <span className="relative">
                  <PlaceArt name={list.coverName ?? list.title} seed={list.coverPlaceId ?? list.id} src={photoUrl(list.coverKey)} className="h-28 w-full md:h-32" rounded="rounded-2xl" />
                  {list.kind === "guide" && <span className="absolute top-2 left-2 rounded-full bg-background px-2 py-0.5 text-[11px] font-black">Guide</span>}
                </span>
                <strong className="line-clamp-2 text-[15px] leading-snug font-extrabold">{list.title}</strong>
                <span className="text-xs font-bold text-muted-foreground">
                  {list.items} places{list.kind !== "guide" && list.ownerName ? ` · ${list.ownerName}` : ""}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
