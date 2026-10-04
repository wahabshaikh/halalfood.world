import { verifiedLabel, type RankedDiner } from "@halalfood/core/leaderboard";
import { avatarUrl } from "@halalfood/core/social";
import { cityName } from "../lib/seo";
import type { EventSummary } from "../lib/events-repository";
import { LocalTime } from "./local-time";
import { PersonAvatar } from "./person";
import { SectionTitle } from "./place-tile";

/** The "Coming up" rail on the For you tab: soonest events first. */
export function ComingUpRow({
  events,
  href = "/events",
}: {
  events: EventSummary[];
  href?: string;
}) {
  if (!events.length) return null;
  return (
    <section className="mb-9 grid gap-3.5" aria-label="Coming up">
      <SectionTitle href={href}>Coming up</SectionTitle>
      <ul className="grid snap-x snap-mandatory auto-cols-[78%] grid-flow-col gap-3 overflow-x-auto pb-1.5 [scrollbar-width:none] md:auto-cols-[calc((100%-2*1rem)/3)] md:gap-4 [&::-webkit-scrollbar]:hidden">
        {events.map((event) => (
          <li key={event.id} className="snap-start">
            <a
              href={`/event/${event.id}`}
              className="grid h-full gap-1 rounded-2xl border p-4 transition-colors hover:bg-secondary/60"
            >
              <LocalTime at={event.startsAt} className="text-[13px] font-bold text-primary" />
              <strong className="leading-snug">{event.title}</strong>
              <span className="text-[13px] text-muted-foreground">
                {cityName(event.citySlug)}
                {event.vendorCount > 0 ? ` · ${event.vendorCount} ${event.vendorCount === 1 ? "vendor" : "vendors"}` : ""}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The weekly leaderboard peek on the For you tab: the top few by verified visits. */
export function WeeklyLeaderboardRow({ diners }: { diners: RankedDiner[] }) {
  if (!diners.length) return null;
  return (
    <section className="mb-9 grid gap-3.5" aria-label="Weekly leaderboard">
      <SectionTitle href="/leaderboard">Weekly leaderboard</SectionTitle>
      <ol className="grid snap-x snap-mandatory auto-cols-[44%] grid-flow-col gap-3 overflow-x-auto pb-1.5 [scrollbar-width:none] md:auto-cols-[calc((100%-3*1rem)/4)] md:gap-4 [&::-webkit-scrollbar]:hidden">
        {diners.map((diner) => (
          <li key={diner.handle} className="snap-start">
            <a
              href={`/u/${diner.handle}`}
              className="grid justify-items-start gap-2 rounded-2xl border p-4 transition-colors hover:bg-secondary/60"
            >
              <span className="flex items-center gap-2">
                <PersonAvatar name={diner.displayName ?? diner.handle} avatarUrl={avatarUrl(diner.handle, diner.avatarKey)} size={36} />
                <span className="text-lg font-extrabold">{diner.rank}</span>
              </span>
              <strong className="max-w-full truncate">@{diner.handle}</strong>
              <span className="text-[13px] text-muted-foreground">{verifiedLabel(diner.verified, "week")}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
