import { CLAIM_BADGE_LABEL, CLAIM_BADGE_NOTE, formatDayHours, type DayHours } from "@/lib/core/owner-claim";
import type { OwnerMenuItem } from "@/lib/owner-claims";
import { SectionTitle } from "./kit";

/** Hours and menu the restaurant provided. Shown only after a moderator approves the claim. */
export function OwnerListing({
  hours,
  hoursNote,
  menu,
}: {
  hours: DayHours[] | null;
  hoursNote: string | null;
  menu: OwnerMenuItem[];
}) {
  if (!hours && menu.length === 0) return null;
  return (
    <>
      {hours && (
        <section aria-labelledby="restaurant-hours" className="grid gap-2.5 max-lg:order-6">
          <SectionTitle id="restaurant-hours">Hours from the restaurant</SectionTitle>
          <ul className="grid md:max-w-xl">
            {hours.map((day) => (
              <li key={day.day} className="border-b border-border/70 py-2 text-[15px] font-semibold last:border-b-0">
                {formatDayHours(day)}
              </li>
            ))}
          </ul>
          {hoursNote && <p className="text-[13px] font-semibold text-muted-foreground">{hoursNote}</p>}
          <p className="text-[13px] font-semibold text-muted-foreground">Typed by the restaurant. Not a halal check.</p>
        </section>
      )}
      {menu.length > 0 && (
        <section aria-labelledby="restaurant-menu" className="grid gap-2.5 max-lg:order-7">
          <SectionTitle id="restaurant-menu">Menu from the restaurant</SectionTitle>
          <ul className="grid md:max-w-xl">
            {menu.map((item) => (
              <li key={item.position} className="grid gap-0.5 border-b border-border/70 py-2 last:border-b-0">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-[15px] font-bold">{item.name}</span>
                  {item.price !== null && (
                    <span className="shrink-0 text-[15px] font-extrabold tabular-nums">
                      {item.price} {item.currency}
                    </span>
                  )}
                </span>
                {item.section && <span className="text-[13px] font-semibold text-muted-foreground">{item.section}</span>}
              </li>
            ))}
          </ul>
          <p className="text-[13px] font-semibold text-muted-foreground">Provided by the restaurant. It is not a halal check.</p>
        </section>
      )}
    </>
  );
}

export function ClaimedLine() {
  return (
    <p className="max-w-xl text-[13px] leading-relaxed font-semibold text-muted-foreground">
      <span className="font-extrabold text-foreground">{CLAIM_BADGE_LABEL}.</span> {CLAIM_BADGE_NOTE}
    </p>
  );
}
