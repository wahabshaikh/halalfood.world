import { ArrowUpRight, Star } from "lucide-react";
import type { Place } from "../lib/places";
import { formatAddress, formatCount } from "../lib/seo";
import SavePlaceButton from "./save-place-button";

function placeInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
  return initials || "HF";
}

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
              <strong className="place-card-monogram">{placeInitials(place.name)}</strong>
              <small className="place-card-visual-caption">Halal place</small>
            </div>
            <div className="place-card-heading">
              <div>
                <p className="place-card-kicker">HALAL LISTING · {place.address_locality || place.city_slug.replace(/-/g, " ")}</p>
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
                  <small>Google</small>
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