import type { Place } from "../lib/places";
import { formatAddress, formatCount } from "../lib/seo";
import SavePlaceButton from "./save-place-button";

/**
 * Server-rendered list of places. Crawlers get real anchors to `/place/<id>`;
 * the map is a progressive enhancement on top, not a prerequisite.
 */
export function PlaceList({ places }: { places: Place[] }) {
  if (!places.length)
    return (
      <p className="empty-state">
        No halal places listed here yet. Try{" "}
        <a href="/cities">another city</a> or search on{" "}
        <a href="/">the map</a>.
      </p>
    );
  return (
    <ol className="place-cards">
      {places.map((place) => (
        <li key={place.id}>
          <article className="place-card">
            <h3>
              <a href={`/place/${place.id}`}>{place.name}</a>
            </h3>
            <p className="place-card-address">{formatAddress(place)}</p>
            <p className="place-card-meta">
              {place.rating_value && (
                <span className="rating-chip">
                  ★ {place.rating_value}
                  {place.review_count
                    ? ` (${formatCount(place.review_count)})`
                    : ""}
                </span>
              )}
              <a
                className="card-link"
                href={`/?place=${encodeURIComponent(place.id)}`}
              >
                Show on map
              </a>
              <SavePlaceButton placeId={place.id} compact />
            </p>
          </article>
        </li>
      ))}
    </ol>
  );
}
