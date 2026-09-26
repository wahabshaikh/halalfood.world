"use client";

import { useEffect, useState } from "react";
import type { SavedPlace } from "../../src/lib/saved-places";
import { formatCount, plural } from "../../src/lib/seo";
import { PlaceTile } from "../../src/components/place-tile";
import { Illustration } from "../../src/components/art";

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
        const payload = (await response.json()) as { places?: SavedPlace[]; total?: number };
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
    return (
      <p className="form-help" role="status">
        Loading your saved places…
      </p>
    );

  if (state === "unauthenticated")
    return (
      <section className="empty-panel" aria-labelledby="saved-login-title">
        <Illustration name="visits" size={80} />
        <h1 id="saved-login-title">Keep your favourites close</h1>
        <p>Log in to save places as you explore and find them again later.</p>
        <div className="button-row">
          <a className="btn btn-primary" href="/login?returnTo=%2Fsaved">
            Log in
          </a>
          <a className="btn btn-line" href="/">
            Keep exploring
          </a>
        </div>
      </section>
    );

  if (state === "error")
    return (
      <section className="empty-panel" aria-labelledby="saved-error-title">
        <h1 id="saved-error-title">Your saved places aren’t loading</h1>
        <p>Please try again in a moment.</p>
        <a className="btn btn-dark" href="/saved">
          Try again
        </a>
      </section>
    );

  return (
    <section aria-labelledby="saved-title">
      <header className="page-intro">
        <h1 id="saved-title">Saved</h1>
        <p className="lead">
          {total
            ? formatCount(total) + " saved " + plural(total, "place") + "."
            : "Tap the heart on any place to keep it here."}
        </p>
      </header>

      {places.length ? (
        <ul className="place-grid">
          {places.map((place) => (
            <li key={place.id}>
              <PlaceTile
                place={place}
                saved
                onSavedChange={(saved) => {
                  if (saved) return;
                  setPlaces((current) => current.filter((item) => item.id !== place.id));
                  setTotal((current) => Math.max(0, current - 1));
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-panel">
          <Illustration name="eat" size={80} />
          <h2>Nothing saved yet</h2>
          <p>When you find somewhere you’d like to try, tap the heart to save it.</p>
          <a className="btn btn-dark" href="/">
            Start exploring
          </a>
        </div>
      )}
    </section>
  );
}
