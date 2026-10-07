"use client";

import { useState } from "react";
import type { ExploreItem } from "@/lib/explore";
import { buttonClass, EmptyState, LIST_GRID } from "./kit";
import { api, errorText, toast } from "./kit-client";
import { PlaceRow } from "./place-row";

/** The first page comes from the server; "Show more" fetches the next. */
export function ExploreList({
  initial,
  total,
  query,
  signedIn,
  pageSize = 30,
}: {
  initial: ExploreItem[];
  total: number;
  query: string;
  signedIn: boolean;
  pageSize?: number;
}) {
  const [places, setPlaces] = useState(initial);
  const [busy, setBusy] = useState(false);
  const more = async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams(query);
      params.set("offset", String(places.length));
      params.set("limit", String(pageSize));
      const result = await api<{ places: ExploreItem[] }>(`/api/places?${params}`);
      setPlaces((current) => [...current, ...result.places.filter((place) => !current.some((other) => other.id === place.id))]);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  if (!places.length)
    return (
      <EmptyState
        title="No places match all of these"
        body="Places with an unknown answer are left out."
        action={
          <a href="?filters=" className={buttonClass("outline", "sm", "mt-1 border-foreground")}>
            Clear filters
          </a>
        }
      />
    );
  return (
    <>
      <ul className={LIST_GRID}>
        {places.map((place) => (
          <PlaceRow key={place.id} place={place} signedIn={signedIn} />
        ))}
      </ul>
      {places.length < total && (
        <button type="button" onClick={more} disabled={busy} className={buttonClass("outline", "md", "mt-4 w-full md:mx-auto md:mt-6 md:w-auto md:px-8")}>
          {busy ? "Loading…" : "Show more"}
        </button>
      )}
    </>
  );
}
