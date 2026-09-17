import { ArrowUpRight, Star, Utensils } from "lucide-react";
import type { Place } from "../lib/places";
import { formatAddress, formatCount } from "../lib/seo";
import SavePlaceButton from "./save-place-button";

export function PlaceList({ places }: { places: Place[] }) {
  if (!places.length)
    return (
      <p className="empty-state">
        No halal places listed here yet. Try <a href="/cities">another city</a> or search on{" "}
        <a href="/">the map</a>.
      </p>
    );

  return (
    <ol className="place-cards">
      {places.map((place) => (
        <li key={place.id}>
          <article className="place-card">
            <div className="place-card-visual" aria-hidden="true">
              <Utensils size={28} strokeWidth={1.4} />
            </div>
            <div className="place-card-heading">
              <div>
                <p className="place-card-kicker">HALAL LISTING</p>
                <h3>
                  <a href={"/place/" + place.id}>{place.name}</a>
                </h3>
              </div>
              <SavePlaceButton placeId={place.id} compact />
            </div>
            <p className="place-card-address">{formatAddress(place)}</p>
            <div className="place-card-meta">
              {place.rating_value && (
                <span className="rating-chip">
                  <Star size={12} fill="currentColor" aria-hidden="true" /> {place.rating_value}
                  {place.review_count ? " (" + formatCount(place.review_count) + ")" : ""}
                </span>
              )}
              <a className="card-link" href={"/?place=" + encodeURIComponent(place.id)}>
                Show on map <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}