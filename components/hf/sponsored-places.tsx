import { SPONSORED_SECTION_NOTE } from "@/lib/core/owner-claim";
import type { FeaturedPlace } from "@/lib/owner-claims";

/**
 * Paid restaurants on a city page. Labelled Sponsored, linked with rel="sponsored",
 * and kept out of the place list so they do not change ranking.
 */
export function SponsoredPlaces({ places, cityLabel }: { places: FeaturedPlace[]; cityLabel: string }) {
  if (!places.length) return null;
  return (
    <section aria-labelledby="sponsored-places" className="grid gap-2.5">
      <h2 id="sponsored-places" className="text-[11px] font-extrabold tracking-[0.14em] text-muted-foreground uppercase">
        Sponsored
      </h2>
      <ul className="grid gap-2">
        {places.map((place) => (
          <li key={place.placeId}>
            <a
              href={`/place/${place.placeId}`}
              rel="sponsored"
              className="flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[11px] font-extrabold tracking-[0.08em] text-muted-foreground uppercase">Sponsored · {cityLabel}</span>
                <span className="truncate text-[17px] font-black text-foreground">{place.name}</span>
                <span className="truncate text-sm font-semibold text-muted-foreground">{place.streetAddress}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs font-semibold leading-relaxed text-muted-foreground">
        {SPONSORED_SECTION_NOTE}{" "}
        <a href="/claim" className="underline underline-offset-2 hover:text-foreground">
          Claim your restaurant
        </a>
      </p>
    </section>
  );
}
