import { cn } from "@halalfood/ui/lib/utils";
import type { ExploreItem } from "../lib/explore";
import { formatDistance, photoUrl } from "../lib/place-view";
import { Avatar, FactTags, PlaceArt, ROW_CARD, StatusPill } from "./kit";
import { SaveHeart } from "./kit-client";

/** One place in a list: art, name, where, status, facts, a friend line and the heart. */
export function PlaceRow({ place, signedIn, compact = false }: { place: ExploreItem; signedIn: boolean; compact?: boolean }) {
  const meta = [place.cuisine, place.area, formatDistance(place.distanceKm)].filter(Boolean).join(" · ");
  return (
    <li className={cn("flex items-center gap-1 border-b border-border/70 last:border-b-0", ROW_CARD, "md:last:border-b md:pr-1 md:pl-3.5")}>
      <a href={`/place/${place.id}`} className="flex min-w-0 flex-1 gap-3.5 py-3.5 text-foreground">
        <PlaceArt
          name={place.name}
          seed={place.id}
          src={photoUrl(place.photoKey)}
          className={compact ? "size-[52px]" : "size-[72px]"}
          rounded={compact ? "rounded-[14px]" : "rounded-2xl"}
          textSize={compact ? "text-base" : "text-xl"}
        />
        <span className="grid min-w-0 content-center gap-1">
          <span className="truncate text-base font-extrabold">{place.name}</span>
          {meta && <span className="truncate text-[13px] font-semibold text-muted-foreground">{meta}</span>}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={place.status} />
            {!compact && <FactTags facts={place.facts} />}
          </span>
          {place.friend && !compact && (
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground/85">
              <Avatar name={place.friend.name} seed={place.friend.userId} size={22} />
              {place.friend.line}
            </span>
          )}
        </span>
      </a>
      <SaveHeart placeId={place.id} saved={place.saved} signedIn={signedIn} label={place.name} />
    </li>
  );
}
