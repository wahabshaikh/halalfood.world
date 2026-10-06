"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import type { ExploreItem } from "@/lib/explore";
import type { ListResult, PersonResult } from "@/lib/search-social";
import { cityName } from "@/lib/place-view";
import { Avatar, EmptyState, Eyebrow, Icon, IconLink, LIST_GRID, LinkButton, Page, PlaceArt, ROW_CARD } from "@/components/hf/kit";
import { api, chipClass } from "@/components/hf/kit-client";
import { PlaceRow } from "@/components/hf/place-row";

type Results = {
  q: string;
  places: ExploreItem[];
  people: PersonResult[];
  lists: ListResult[];
  cities: { city_slug: string; place_count: number }[];
};

const EMPTY: Results = { q: "", places: [], people: [], lists: [], cities: [] };

export function SearchScreen({
  initialQuery,
  city,
  signedIn,
  focusPeople,
}: {
  initialQuery: string;
  city: string | null;
  signedIn: boolean;
  focusPeople: boolean;
}) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<Results>(EMPTY);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const latest = useRef(0);

  useEffect(() => {
    const query = q.trim();
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
    if (!query) {
      setResults(EMPTY);
      setState("idle");
      return;
    }
    const id = ++latest.current;
    setState("loading");
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query });
        if (city) params.set("city", city);
        const body = await api<Results>(`/api/search?${params}`);
        if (id === latest.current) {
          setResults(body);
          setState("idle");
        }
      } catch {
        if (id === latest.current) setState("error");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [q, city]);

  const blank = !q.trim();
  const none = !blank && state === "idle" && results.q && !results.places.length && !results.people.length && !results.lists.length && !results.cities.length;
  const tries = ["biryani", "shawarma", "kebab", city ? cityName(city) : "London"];

  return (
    <Page className="pt-[18px] md:pt-8">
      <header className="-mx-2.5 flex items-center gap-1.5 pb-3 md:pb-6">
        <IconLink href={city ? `/city/${city}` : "/"} label="Back" icon={ArrowLeft01Icon} />
        <label htmlFor="search-input" className="sr-only">
          Search places, dishes, people
        </label>
        <div className="flex h-[50px] flex-1 items-center gap-2.5 rounded-full border-2 border-foreground bg-secondary px-4 md:max-w-2xl">
          <Icon icon={Search01Icon} />
          <input
            id="search-input"
            type="search"
            autoFocus
            value={q}
            maxLength={120}
            onChange={(event) => setQ(event.target.value)}
            placeholder={focusPeople ? "Name or @handle" : "Search places, dishes, people"}
            className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none"
          />
        </div>
      </header>

      <div className="grid gap-[22px] pt-1 md:gap-9">
        {blank && (
          <section className="grid gap-2.5">
            <Eyebrow>Try</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {tries.map((term) => (
                <button key={term} type="button" className={chipClass(false)} onClick={() => setQ(term)}>
                  {term}
                </button>
              ))}
            </div>
          </section>
        )}
        {state === "error" && <p className="text-sm font-bold text-destructive">Search isn’t working right now. Try again in a moment.</p>}
        {results.places.length > 0 && (
          <section className="grid gap-1 md:gap-3">
            <Eyebrow>Places</Eyebrow>
            <ul className={LIST_GRID}>
              {results.places.map((place) => (
                <PlaceRow key={place.id} place={place} signedIn={signedIn} compact />
              ))}
            </ul>
          </section>
        )}
        {results.people.length > 0 && (
          <section className="grid gap-1 md:gap-3">
            <Eyebrow>People</Eyebrow>
            <ul className={LIST_GRID}>
              {results.people.map((person) => (
                <li key={person.userId}>
                  <a href={`/u/${person.handle}`} className={cn("flex min-h-[60px] items-center gap-3 border-b border-border text-foreground", ROW_CARD)}>
                    <Avatar name={person.name} seed={person.userId} src={person.avatarKey ? `/api/avatars/${person.handle}` : null} size={44} />
                    <span className="grid">
                      <span className="text-base font-extrabold">{person.name}</span>
                      <span className="text-[13px] font-semibold text-muted-foreground">
                        @{person.handle}
                        {person.homeCity ? ` · ${cityName(person.homeCity)}` : ""}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {results.lists.length > 0 && (
          <section className="grid gap-1 md:gap-3">
            <Eyebrow>Lists &amp; guides</Eyebrow>
            <ul className={LIST_GRID}>
              {results.lists.map((list) => (
                <li key={list.id}>
                  <a href={`/list/${list.id}`} className={cn("flex min-h-16 items-center gap-3 border-b border-border text-foreground", ROW_CARD)}>
                    <PlaceArt name={list.title} seed={list.coverPlaceId ?? list.id} className="size-[52px]" rounded="rounded-[14px]" textSize="text-base" />
                    <span className="grid">
                      <span className="text-base font-extrabold">{list.title}</span>
                      <span className="text-[13px] font-semibold text-muted-foreground">
                        {list.kind === "guide" ? "Guide" : list.ownerName} · {list.items} places
                        {list.saves ? ` · ${list.saves} saves` : ""}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {results.cities.length > 0 && (
          <section className="grid gap-1 md:gap-3">
            <Eyebrow>Cities</Eyebrow>
            <ul className={LIST_GRID}>
              {results.cities.map((item) => (
                <li key={item.city_slug}>
                  <a href={`/city/${item.city_slug}`} className={cn("flex min-h-[52px] items-center justify-between border-b border-border text-base font-extrabold text-foreground", ROW_CARD)}>
                    {cityName(item.city_slug)}
                    <span className="text-[13px] font-bold text-muted-foreground">{item.place_count.toLocaleString("en")} places</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {none && (
          <EmptyState title="Nothing listed yet" body="If it’s on Google Maps, you can add it." action={<LinkButton href="/add" size="md">Add a place</LinkButton>} />
        )}
      </div>
    </Page>
  );
}
