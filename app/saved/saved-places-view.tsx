"use client";

import { useEffect, useState } from "react";
import type { SavedPlace } from "../../src/lib/saved-places";
import { formatAddress, formatCount, plural } from "../../src/lib/seo";
import SavePlaceButton from "../../src/components/save-place-button";

type ViewState = "loading" | "ready" | "unauthenticated" | "error";

export default function SavedPlacesView() {
  const [state, setState] = useState<ViewState>("loading");
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/places/saved", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 401) {
          setState("unauthenticated");
          return;
        }
        if (!response.ok) throw new Error();
        const payload = (await response.json()) as {
          places?: SavedPlace[];
          total?: number;
        };
        setPlaces(Array.isArray(payload.places) ? payload.places : []);
        setTotal(
          typeof payload.total === "number"
            ? payload.total
            : Array.isArray(payload.places)
              ? payload.places.length
              : 0,
        );
        setState("ready");
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setState("error");
      });
    return () => controller.abort();
  }, []);

  if (state === "loading")
    return <p className="sheet-status" role="status">Loading saved places…</p>;

  if (state === "unauthenticated")
    return (
      <section className="auth-card saved-auth-card" aria-labelledby="saved-login-title">
        <p className="eyebrow">YOUR LIST</p>
        <h1 id="saved-login-title">Sign in to see saved places</h1>
        <p className="lead">
          Save halal places while you explore, then come back to them here.
        </p>
        <div className="detail-actions">
          <a className="action primary" href="/login?returnTo=%2Fsaved">
            Sign in
          </a>
          <a className="action" href="/">
            Explore the map
          </a>
        </div>
      </section>
    );

  if (state === "error")
    return (
      <section className="saved-error" aria-labelledby="saved-error-title">
        <p className="eyebrow">YOUR LIST</p>
        <h1 id="saved-error-title">Saved places are not loading</h1>
        <p className="lead">Please try again in a moment.</p>
        <a className="action primary" href="/saved">
          Try again
        </a>
      </section>
    );

  return (
    <section className="saved-section" aria-labelledby="saved-title">
      <header className="page-intro">
        <p className="eyebrow">YOUR LIST</p>
        <h1 id="saved-title">Saved places</h1>
        <p className="lead">
          {total
            ? `${formatCount(total)} saved ${plural(total, "place")}.`
            : "Keep a shortlist of halal places you want to revisit."}
        </p>
      </header>

      {places.length ? (
        <ol className="place-cards">
          {places.map((place) => (
            <li key={place.id}>
              <article className="place-card saved-place-card">
                <h2>
                  <a href={`/place/${place.id}`}>{place.name}</a>
                </h2>
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
                  {typeof place.lat === "number" && typeof place.lng === "number" && (
                    <a
                      className="card-link"
                      href={`/?place=${encodeURIComponent(place.id)}`}
                    >
                      Show on map
                    </a>
                  )}
                  <SavePlaceButton
                    placeId={place.id}
                    compact
                    initialSaved
                    onSavedChange={(saved) => {
                      if (saved) return;
                      setPlaces((current) =>
                        current.filter((currentPlace) => currentPlace.id !== place.id),
                      );
                      setTotal((current) => Math.max(0, current - 1));
                    }}
                  />
                </p>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-state">
          Nothing saved yet. Browse <a href="/">the map</a> and tap Save on a
          halal place you want to remember.
        </p>
      )}
    </section>
  );
}
