"use client";

import { useMemo, useState } from "react";
import { Gps01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";

type CityOption = { slug: string; name: string; country: string | null; count: number };

const choose = (slug: string) => `/eating?city=${encodeURIComponent(slug)}&next=${encodeURIComponent(`/city/${slug}`)}`;

export function CityPicker({ cities, current }: { cities: CityOption[]; current: string | null }) {
  const [q, setQ] = useState("");
  const [locating, setLocating] = useState(false);
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? cities.filter((city) => `${city.name} ${city.country ?? ""}`.toLowerCase().includes(query)) : cities;
  }, [q, cities]);
  const locate = () => {
    if (!navigator.geolocation) return toast("Your browser can’t share a location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const result = await api<{ city: string | null }>(
            `/api/cities/nearest?lat=${position.coords.latitude}&lng=${position.coords.longitude}`,
          );
          if (result.city) window.location.assign(choose(result.city));
          else toast("No listed city near you yet.");
        } catch (error) {
          toast(errorText(error));
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        toast("Location is off. Pick a city instead.");
      },
      { timeout: 10000, maximumAge: 600000 },
    );
  };
  return (
    <div className="grid gap-1">
      <label htmlFor="city-search" className="sr-only">
        Find a city
      </label>
      <div className="mb-2 flex h-[50px] items-center gap-2.5 rounded-full bg-secondary px-4 md:mb-4 md:max-w-md">
        <Icon icon={Search01Icon} />
        <input
          id="city-search"
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Find a city"
          className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none"
        />
      </div>
      <button
        type="button"
        onClick={locate}
        disabled={locating}
        className="flex min-h-14 items-center gap-3 border-b border-border text-left text-base font-extrabold text-primary md:mb-2 md:w-fit md:border-b-0"
      >
        <Icon icon={Gps01Icon} size={22} />
        {locating ? "Finding you…" : "Use my location"}
      </button>
      <ul className="md:grid md:grid-cols-2 md:gap-x-10 lg:grid-cols-3">
        {shown.map((city) => (
          <li key={city.slug}>
            <a href={choose(city.slug)} className="flex min-h-14 items-center justify-between gap-3 border-b border-border text-foreground">
              <span className="grid">
                <span className="text-base font-extrabold">{city.name}</span>
                {city.country && <span className="text-[13px] font-semibold text-muted-foreground">{city.country}</span>}
              </span>
              <span className="flex items-center gap-2 text-[13px] font-bold text-muted-foreground">
                {city.count.toLocaleString("en")} places
                {city.slug === current && <Icon icon={Tick02Icon} size={16} className="text-primary" strokeWidth={3} />}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {!shown.length && <p className="py-8 text-center text-sm text-muted-foreground">No city matches “{q}”.</p>}
    </div>
  );
}
