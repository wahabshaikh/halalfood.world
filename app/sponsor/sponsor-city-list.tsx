"use client";

import { useMemo, useState } from "react";
import { ArrowRight01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/hf/kit";

type CityOption = { slug: string; name: string; country: string | null; count: number; sponsoredUntil: string | null };

/** Every city, searchable, with whether it already has a sponsor. */
export function SponsorCityList({ cities }: { cities: CityOption[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    const matches = query ? cities.filter((city) => `${city.name} ${city.country ?? ""}`.toLowerCase().includes(query)) : cities;
    return matches.slice(0, 100);
  }, [q, cities]);
  return (
    <div className="grid gap-2">
      <label htmlFor="sponsor-city-search" className="sr-only">
        Find a city
      </label>
      <div className="flex h-[50px] items-center gap-2.5 rounded-full bg-secondary px-4 md:max-w-md">
        <Icon icon={Search01Icon} />
        <input
          id="sponsor-city-search"
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Find a city"
          className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none"
        />
      </div>
      {shown.length === 0 ? (
        <p className="py-4 text-[15px] font-semibold text-muted-foreground">No listed city matches that yet.</p>
      ) : (
        <ul className="grid divide-y divide-border/70">
          {shown.map((city) => (
            <li key={city.slug}>
              <a href={`/sponsor/${city.slug}`} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-extrabold">{city.name}</span>
                  <span className="block truncate text-sm font-semibold text-muted-foreground">
                    {[city.country, `${city.count} ${city.count === 1 ? "place" : "places"}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-sm font-bold">
                  {city.sponsoredUntil ? (
                    <span className="text-muted-foreground">Sponsored until {city.sponsoredUntil}</span>
                  ) : (
                    <span className="text-success">Available</span>
                  )}
                  <Icon icon={ArrowRight01Icon} size={18} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
