import type { EventSummary } from "../lib/events";
import { AvatarStack } from "./kit";
import { LocalTime } from "./local-time";

export function DateBlock({ at }: { at: number }) {
  const date = new Date(at);
  return (
    <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-accent text-primary">
      <span className="text-[11px] font-black uppercase">{date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>
      <span className="text-xl leading-none font-black">{date.getUTCDate()}</span>
    </span>
  );
}

export function stallsLine(event: Pick<EventSummary, "stalls" | "verifiedStalls">): string {
  return event.stalls ? `${event.verifiedStalls} of ${event.stalls} stalls verified` : "Stalls coming soon";
}

export function friendsLine(event: Pick<EventSummary, "friends" | "going">, viewerId: string | null): string | null {
  const others = event.friends.filter((friend) => friend.userId !== viewerId);
  const me = event.friends.some((friend) => friend.userId === viewerId);
  if (!others.length) return me ? "You’re going" : event.going ? `${event.going} going` : null;
  const first = others[0].name.split(" ")[0];
  const rest = others.length - 1;
  return `${me ? "You, " : ""}${first}${rest ? ` and ${rest} friend${rest === 1 ? "" : "s"}` : ""} going`;
}

export function EventRow({ event, viewerId }: { event: EventSummary; viewerId: string | null }) {
  const friends = friendsLine(event, viewerId);
  return (
    <a href={`/event/${event.id}`} className="flex items-center gap-3.5 border-b border-border/70 py-3.5 text-foreground last:border-b-0">
      <DateBlock at={event.startsAt} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <strong className="truncate text-base font-extrabold">{event.title}</strong>
        <span className="truncate text-[13px] font-semibold text-muted-foreground">
          <LocalTime at={event.startsAt} /> · {event.venue}
        </span>
        <span className="text-[13px] font-bold text-success">{stallsLine(event)}</span>
        {friends && (
          <span className="flex items-center gap-1.5 text-[13px] font-bold">
            <AvatarStack people={event.friends.slice(0, 3).map((friend) => ({ name: friend.name, seed: friend.userId }))} size={20} />
            {friends}
          </span>
        )}
      </span>
    </a>
  );
}
