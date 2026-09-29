"use client";

import { useEffect, useState } from "react";
import { Input } from "@halalfood/ui/components/input";
import { Loading } from "../../src/components/blocks";
import { Note } from "../../src/components/section";
import { cityName } from "../../src/lib/seo";

type Result = { id: string; name: string; city_slug: string; street_address: string };

/** Search halal places by name or area, then open the log sheet for one. */
export default function PlacePicker() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState("loading");
      fetch(`/api/places/search?q=${encodeURIComponent(query)}&limit=8`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const payload = (await response.json()) as { places?: Result[] };
          setResults(Array.isArray(payload.places) ? payload.places : []);
          setState("idle");
        })
        .catch((error) => {
          if ((error as Error).name !== "AbortError") setState("error");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return (
    <div className="grid gap-4">
      <Input
        type="search"
        aria-label="Search for the place you ate at"
        placeholder="Search by restaurant or area"
        autoComplete="off"
        maxLength={120}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      {state === "loading" && <Loading>Searching…</Loading>}
      {state === "error" && <Note>Search is unavailable right now. Please try again.</Note>}
      {state === "idle" && term.trim().length >= 2 && results.length === 0 && (
        <Note>No halal places match that yet.</Note>
      )}
      {results.length > 0 && (
        <ul className="divide-y rounded-2xl border">
          {results.map((place) => (
            <li key={place.id}>
              <a
                href={`/log?place=${encodeURIComponent(place.id)}`}
                className="grid gap-0.5 px-4 py-3.5 hover:bg-secondary"
              >
                <span className="font-bold">{place.name}</span>
                <span className="text-sm text-muted-foreground">
                  {place.street_address ? `${place.street_address} · ` : ""}
                  {cityName(place.city_slug)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
