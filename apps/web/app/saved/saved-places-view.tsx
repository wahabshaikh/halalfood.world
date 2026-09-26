"use client";

import { useEffect, useState } from "react";
import type { SavedPlace } from "../../src/lib/saved-places";
import { formatCount, plural } from "../../src/lib/seo";
import { Button } from "@halalfood/ui/components/button";
import { Spinner } from "@halalfood/ui/components/spinner";
import { PLACE_GRID, PlaceTile } from "../../src/components/place-tile";
import { EmptyPanel, PageIntro } from "../../src/components/site-chrome";

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
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner /> Loading your saved places…
      </p>
    );

  if (state === "unauthenticated")
    return (
      <section aria-labelledby="saved-login-title">
        <EmptyPanel
          art="visits"
          titleId="saved-login-title"
          title="Keep your favourites close"
          description="Log in to save places as you explore and find them again later."
        >
          <Button asChild size="xl">
            <a href="/login?returnTo=%2Fsaved">Log in</a>
          </Button>
          <Button asChild size="xl" variant="outline">
            <a href="/">Keep exploring</a>
          </Button>
        </EmptyPanel>
      </section>
    );

  if (state === "error")
    return (
      <section aria-labelledby="saved-error-title">
        <EmptyPanel
          art={null}
          titleId="saved-error-title"
          title="Your saved places aren’t loading"
          description="Please try again in a moment."
        >
          <Button asChild size="xl">
            <a href="/saved">Try again</a>
          </Button>
        </EmptyPanel>
      </section>
    );

  return (
    <section aria-labelledby="saved-title">
      <PageIntro
        titleId="saved-title"
        title="Saved"
        lead={
          total
            ? formatCount(total) + " saved " + plural(total, "place") + "."
            : "Tap the heart on any place to keep it here."
        }
      />

      {places.length ? (
        <ul className={PLACE_GRID}>
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
        <EmptyPanel
          titleAs="h2"
          title="Nothing saved yet"
          description="When you find somewhere you’d like to try, tap the heart to save it."
        >
          <Button asChild size="xl">
            <a href="/">Start exploring</a>
          </Button>
        </EmptyPanel>
      )}
    </section>
  );
}
