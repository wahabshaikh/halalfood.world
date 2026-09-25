import { ChevronRight, Star } from "lucide-react";
import type { Place } from "../lib/places";
import { cityName, formatCount } from "../lib/seo";
import { PlacePhoto } from "./place-photo";
import SavePlaceButton from "./save-place-button";

type TilePlace = Pick<
  Place,
  "id" | "name" | "city_slug" | "street_address" | "address_locality" | "rating_value" | "review_count"
>;

function locality(place: TilePlace) {
  return place.address_locality || cityName(place.city_slug);
}

/** A photo-first place card, in the style of a stay listing. */
export function PlaceTile({
  place,
  size = "default",
  saved = false,
  onSavedChange,
}: {
  place: TilePlace;
  size?: "default" | "large";
  /** Start in the saved state (the Saved page already knows). */
  saved?: boolean;
  onSavedChange?: (saved: boolean) => void;
}) {
  const href = "/place/" + encodeURIComponent(place.id);
  return (
    <article className={size === "large" ? "place-tile is-large" : "place-tile"}>
      <div className="place-tile-media">
        <a href={href} tabIndex={-1} aria-hidden="true">
          <PlacePhoto seed={place.id} name={place.name} />
        </a>
        <span className="place-tile-save">
          <SavePlaceButton
            placeId={place.id}
            heart
            initialSaved={saved}
            onSavedChange={onSavedChange}
          />
        </span>
      </div>
      <div className="place-tile-body">
        <div className="place-tile-title-row">
          <h3 className="place-tile-title">
            <a href={href}>{place.name}</a>
          </h3>
          {place.rating_value && (
            <span className="place-tile-rating" aria-label={`Google rating ${place.rating_value}`}>
              <Star size={12} fill="currentColor" aria-hidden="true" />
              {place.rating_value}
            </span>
          )}
        </div>
        <p className="place-tile-meta">{locality(place)}</p>
        <p className="place-tile-meta">
          {place.review_count
            ? formatCount(place.review_count) + " Google reviews"
            : place.street_address}
        </p>
      </div>
    </article>
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
    <section className="place-row" aria-label={title}>
      <h2 className="section-title">
        {href ? (
          <a href={href}>
            {title}
            <ChevronRight size={20} strokeWidth={2.6} aria-hidden="true" />
          </a>
        ) : (
          title
        )}
      </h2>
      <ul className="place-row-track">
        {places.map((place) => (
          <li key={place.id}>
            <PlaceTile place={place} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A responsive grid of tiles for results, cities and saved lists. */
export function PlaceGrid({ places }: { places: TilePlace[] }) {
  return (
    <ul className="place-grid">
      {places.map((place) => (
        <li key={place.id}>
          <PlaceTile place={place} />
        </li>
      ))}
    </ul>
  );
}
