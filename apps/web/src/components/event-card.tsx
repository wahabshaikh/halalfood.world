import { Badge } from "@halalfood/ui/components/badge";
import { Card } from "@halalfood/ui/components/card";
import { plural } from "../lib/seo";
import { cityName } from "../lib/seo";
import type { EventSummary } from "../lib/events-repository";
import { LocalTime } from "./local-time";

/** One event in a list: when, where, how many vendors and how many are going. */
export function EventCard({ event, showCity = true }: { event: EventSummary; showCity?: boolean }) {
  return (
    <Card className="gap-1.5 px-5 py-4 transition-colors hover:bg-secondary/60" data-testid="event-card">
      <a href={`/event/${event.id}`} className="grid gap-1.5">
        <span className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-primary">
          <LocalTime at={event.startsAt} />
          {event.phase === "live" && <Badge variant="success">On now</Badge>}
        </span>
        <strong className="text-[17px] leading-snug">{event.title}</strong>
        <span className="text-sm text-muted-foreground">
          {event.venue}
          {showCity ? ` · ${cityName(event.citySlug)}` : ""}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {event.vendorCount > 0 && `${event.vendorCount} ${plural(event.vendorCount, "vendor")}`}
          {event.vendorCount > 0 && event.going > 0 && " · "}
          {event.going > 0 && `${event.going} going`}
        </span>
      </a>
    </Card>
  );
}
