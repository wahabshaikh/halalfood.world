import type { Place } from "../lib/places";
import { cityName, formatCount } from "../lib/seo";
import { formatDistance } from "../lib/visitor-location";
import { cardEvidenceLine } from "@halalfood/core/card-evidence";
import { STATUS_COPY, type HalalTaxonomyStatus } from "@halalfood/core/halal-taxonomy";
import { cn } from "@halalfood/ui/lib/utils";
import { PlacePhoto } from "./place-photo";
import { TONE_TEXT } from "./status-tone";
import SavePlaceButton from "./save-place-button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

type TilePlace = Pick<
  Place,
  "id" | "name" | "city_slug" | "street_address" | "address_locality" | "rating_value" | "review_count"
> & {
  /** Present on discovery results; shown instead of the address when set. */
  distance_km?: number | null;
  halal_status?: HalalTaxonomyStatus;
  latest_evidence_at?: number | null;
  /** Set when a status query finished. False means the card must not say Unverified. */
  evidence_loaded?: boolean;
};

function locality(place: TilePlace) {
  return place.address_locality || cityName(place.city_slug);
}

/** A photo-first place card, in the style of a stay listing. */
export function PlaceTile({
  place,
  size = "default",
  saved = false,
  onSavedChange,
  status,
}: {
  place: TilePlace;
  /** Derived halal status, when the caller already has it (map, discovery). */
  status?: HalalTaxonomyStatus;
  size?: "default" | "large";
  /** Start in the saved state (the Saved page already knows). */
  saved?: boolean;
  onSavedChange?: (saved: boolean) => void;
}) {
  const href = "/place/" + encodeURIComponent(place.id);
  const halalStatus = status ?? place.halal_status;
  const evidenceFailed = !status && place.evidence_loaded === false;
  const evidenceKnown =
    !evidenceFailed &&
    (Boolean(status) || place.evidence_loaded === true || place.halal_status != null);
  const evidence =
    evidenceKnown && halalStatus
      ? cardEvidenceLine({
          status: halalStatus,
          latestEvidenceAt: place.latest_evidence_at,
        })
      : null;
  const distance =
    typeof place.distance_km === "number" ? formatDistance(place.distance_km) : "";
  return (
    <article className="flex min-w-0 flex-col gap-2.5">
      <div className="relative">
        <a href={href} tabIndex={-1} aria-hidden="true" className="block">
          <PlacePhoto
            seed={place.id}
            name={place.name}
            className={size === "large" ? "aspect-[4/3]" : undefined}
          />
        </a>
        <span className="absolute top-2.5 right-2.5">
          <SavePlaceButton
            placeId={place.id}
            heart
            initialSaved={saved}
            onSavedChange={onSavedChange}
          />
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-start justify-between gap-2.5">
          <h3 className="text-[15px] leading-tight font-extrabold">
            <a href={href} className="hover:underline">
              {place.name}
            </a>
          </h3>
          {place.rating_value && (
            <span className="text-sm font-semibold whitespace-nowrap">
              Google {place.rating_value}
            </span>
          )}
        </div>
        {evidence ? (
          <p className={cn("text-sm font-bold", TONE_TEXT[STATUS_COPY[evidence.status].tone])}>
            {evidence.line}
            <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
              {evidence.source}
            </span>
          </p>
        ) : place.evidence_loaded === false ? (
          <p className="text-sm font-bold">Evidence status unavailable</p>
        ) : null}
        {evidence?.status === "unverified" && (
          <p className="text-xs text-muted-foreground">Unverified does not mean not halal.</p>
        )}
        <p className="text-sm leading-snug text-muted-foreground">
          {distance ? `${distance} away · ${locality(place)}` : locality(place)}
        </p>
        <p className="text-sm leading-snug text-muted-foreground">
          {place.review_count
            ? formatCount(place.review_count) + " Google reviews"
            : place.street_address}
        </p>
      </div>
    </article>
  );
}

/** A section heading that optionally links to the full list. */
export function SectionTitle({
  id,
  href,
  children,
  className,
}: {
  id?: string;
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 id={id} className={cn("text-[22px] font-extrabold tracking-tight", className)}>
      {href ? (
        <a href={href} className="inline-flex items-center gap-0.5 hover:underline">
          {children}
          <HugeiconsIcon icon={ArrowRight01Icon} size={20} strokeWidth={2.6} aria-hidden="true" />
        </a>
      ) : (
        children
      )}
    </h2>
  );
}

/** A horizontally scrolling row of tiles with a linked title. */
export function PlaceRow({
  title,
  href,
  places,
}: {
  title: string;
  href?: string;
  places: TilePlace[];
}) {
  if (!places.length) return null;
  return (
    <section className="mb-9 grid gap-3.5" aria-label={title}>
      <SectionTitle href={href}>{title}</SectionTitle>
      <ul className="grid snap-x snap-mandatory auto-cols-[44%] grid-flow-col gap-3 overflow-x-auto pb-1.5 [scrollbar-width:none] md:auto-cols-[calc((100%-3*1rem)/4)] md:gap-4 xl:auto-cols-[calc((100%-5*1rem)/6)] [&::-webkit-scrollbar]:hidden">
        {places.map((place) => (
          <li key={place.id} className="snap-start">
            <PlaceTile place={place} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Layout for a grid of place tiles, for callers that render their own tiles. */
export const PLACE_GRID =
  "grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]";

/** A responsive grid of tiles for results, cities and saved lists. */
export function PlaceGrid({ places }: { places: TilePlace[] }) {
  return (
    <ul className={PLACE_GRID}>
      {places.map((place) => (
        <li key={place.id}>
          <PlaceTile place={place} />
        </li>
      ))}
    </ul>
  );
}
