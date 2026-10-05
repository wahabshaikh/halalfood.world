"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ArrowRight01Icon, Gps01Icon, ListViewIcon, Search01Icon } from "@hugeicons/core-free-icons";
import type { Map as MapInstance, Marker } from "maplibre-gl";
import type { Filter } from "@halalfood/core/halal";
import { discoveryBboxExceedsCap, type DiscoveryBbox } from "@halalfood/core/discovery-bbox";
import { cn } from "@halalfood/ui/lib/utils";
import type { ExploreItem } from "../../src/lib/explore";
import { formatDistance, photoUrl } from "../../src/lib/place-view";
import { Avatar, Icon, PlaceArt, StatusPill, buttonClass } from "../../src/components/kit";
import { FilterChips, api, errorText, storeFilters, toast } from "../../src/components/kit-client";
import { PlaceRow } from "../../src/components/place-row";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const LIMIT = 300;

function viewportBbox(bounds: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }): DiscoveryBbox {
  const wrap = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;
  const world = bounds.getEast() - bounds.getWest() >= 360;
  return {
    west: world ? -180 : wrap(bounds.getWest()),
    south: Math.max(-90, bounds.getSouth()),
    east: world ? 180 : wrap(bounds.getEast()),
    north: Math.min(90, bounds.getNorth()),
  };
}

function Pin({ place, selected }: { place: ExploreItem; selected: boolean }) {
  const size = selected ? 44 : 34;
  const tone =
    place.status.kind === "verified"
      ? "border-white bg-success text-white"
      : place.status.kind === "checking"
        ? "border-warning-strong bg-white text-warning-strong"
        : "border-white bg-muted-foreground text-white";
  return (
    <span
      className={cn(
        "relative flex items-center justify-center rounded-full border-[3px] shadow-[0_4px_12px_rgba(31,26,23,0.3)]",
        tone,
        selected && "outline-3 outline-offset-2 outline-primary",
      )}
      style={{ width: size, height: size }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={place.status.kind === "verified" ? "M5 12.5l4.5 4.5L19 7.5" : place.status.kind === "checking" ? "M12 7v5l3 2" : "M12 8v.01M12 12v4"} />
      </svg>
      {place.friend && (
        <span className="absolute -top-3 -right-3.5">
          <Avatar name={place.friend.name} seed={place.friend.userId} size={24} ring />
        </span>
      )}
    </span>
  );
}

export default function MapView({
  initialView,
  citySlug,
  initialFilters,
  initialFriends,
  signedIn,
  selectedId,
}: {
  initialView: { center: [number, number]; zoom: number };
  citySlug: string | null;
  initialFilters: Filter[];
  initialFriends: boolean;
  signedIn: boolean;
  selectedId: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const markers = useRef<{ marker: Marker; root: Root }[]>([]);
  const [ready, setReady] = useState(false);
  const [broken, setBroken] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [friends, setFriends] = useState(initialFriends);
  const [places, setPlaces] = useState<ExploreItem[]>([]);
  const [selected, setSelected] = useState<string | null>(selectedId);
  const [moved, setMoved] = useState(false);
  const [tooWide, setTooWide] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const ignoreMove = useRef(true);

  const syncUrl = useCallback(
    (next: { place?: string | null }) => {
      const url = new URL(window.location.href);
      url.searchParams.set("filters", filters.join(","));
      if (friends) url.searchParams.set("friends", "1");
      else url.searchParams.delete("friends");
      if (next.place) url.searchParams.set("place", next.place);
      else if (next.place === null) url.searchParams.delete("place");
      window.history.replaceState(null, "", url);
    },
    [filters, friends],
  );

  const load = useCallback(async () => {
    const instance = map.current;
    const params = new URLSearchParams({ filters: filters.join(","), limit: String(LIMIT) });
    if (friends) params.set("friends", "1");
    if (instance) {
      const bbox = viewportBbox(instance.getBounds());
      if (discoveryBboxExceedsCap(bbox)) {
        setTooWide(true);
        setMoved(false);
        return;
      }
      params.set("bbox", [bbox.west, bbox.south, bbox.east, bbox.north].join(","));
      const center = instance.getCenter();
      params.set("near", `${center.lat},${center.lng}`);
    } else if (citySlug) {
      params.set("city", citySlug);
    }
    setTooWide(false);
    setMoved(false);
    setLoading(true);
    try {
      const result = await api<{ places: ExploreItem[] }>(`/api/places?${params}`);
      setPlaces(result.places);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [filters, friends, citySlug]);

  // Start the map, or fall back to a list when the browser can't draw it.
  useEffect(() => {
    let cancelled = false;
    let webgl = false;
    try {
      const probe = document.createElement("canvas");
      webgl = Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    } catch {
      webgl = false;
    }
    if (!webgl) {
      setBroken(true);
      return;
    }
    import("maplibre-gl")
      .then((lib) => {
        if (cancelled || !container.current) return;
        lib.setWorkerUrl(mapWorkerUrl);
        const instance = new lib.Map({
          container: container.current,
          style: STYLE,
          center: initialView.center,
          zoom: initialView.zoom,
          attributionControl: { compact: true },
        });
        map.current = instance;
        instance.on("load", () => {
          setReady(true);
          // The first idle after load is the camera settling, not the person panning.
          instance.once("idle", () => {
            ignoreMove.current = false;
          });
        });
        instance.on("moveend", () => {
          if (!ignoreMove.current) setMoved(true);
        });
        instance.on("error", () => undefined);
      })
      .catch(() => {
        if (!cancelled) setBroken(true);
      });
    return () => {
      cancelled = true;
      for (const { marker, root } of markers.current) {
        marker.remove();
        queueMicrotask(() => root.unmount());
      }
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, [initialView]);

  // Load on start and whenever the filters change.
  useEffect(() => {
    if (ready || broken) void load();
    syncUrl({});
  }, [ready, broken, load, syncUrl]);

  // Draw the pins.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    let stopped = false;
    void import("maplibre-gl").then((lib) => {
      if (stopped) return;
      for (const { marker, root } of markers.current) {
        marker.remove();
        queueMicrotask(() => root.unmount());
      }
      markers.current = [];
      for (const place of places) {
        if (place.lat === null || place.lng === null) continue;
        const element = document.createElement("button");
        element.type = "button";
        element.setAttribute("aria-label", place.name);
        element.style.background = "transparent";
        element.style.border = "0";
        element.style.padding = "0";
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          setSelected(place.id);
        });
        const root = createRoot(element);
        root.render(<Pin place={place} selected={place.id === selected} />);
        const marker = new lib.Marker({ element }).setLngLat([place.lng, place.lat]).addTo(instance);
        if (place.id === selected) element.style.zIndex = "2";
        markers.current.push({ marker, root });
      }
    });
    return () => {
      stopped = true;
    };
  }, [places, ready, selected]);

  useEffect(() => {
    syncUrl({ place: selected });
  }, [selected, syncUrl]);

  const locate = () => {
    if (!navigator.geolocation) return toast("Your browser can’t share a location.");
    navigator.geolocation.getCurrentPosition(
      (position) => map.current?.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 14 }),
      () => toast("Location is off."),
      { timeout: 10000, maximumAge: 600000 },
    );
  };

  const current = places.find((place) => place.id === selected) ?? null;
  const listHref = citySlug ? `/city/${citySlug}?filters=${filters.join(",")}${friends ? "&friends=1" : ""}` : "/";

  if (broken)
    return (
      <div className="mx-auto max-w-2xl px-5 pt-5">
        <p className="mb-3 rounded-xl bg-secondary px-4 py-3 text-sm font-bold">This browser can’t draw the map. Here are the same places as a list.</p>
        <FilterChips filters={filters} friends={friends} showFriends={signedIn} onChange={(next) => (setFilters(next.filters), setFriends(next.friends))} />
        <ul className="mt-3">
          {places.map((place) => (
            <PlaceRow key={place.id} place={place} signedIn={signedIn} />
          ))}
        </ul>
      </div>
    );

  return (
    <div className="map-stage relative h-[calc(100dvh-84px-env(safe-area-inset-bottom))] w-full overflow-hidden bg-map md:h-[calc(100dvh-64px)]">
      <div ref={container} className="map-canvas absolute inset-0" role="region" aria-label="Map of places" />

      <div className="absolute inset-x-0 top-0 z-10 grid gap-2.5 pt-[18px] pb-2.5">
        <div className="flex gap-2 px-4">
          <a
            href={citySlug ? `/search?city=${citySlug}` : "/search"}
            className="flex h-[50px] flex-1 items-center gap-2.5 rounded-full bg-background px-[18px] text-[15px] font-semibold text-muted-foreground shadow-md"
          >
            <Icon icon={Search01Icon} className="text-foreground" />
            Search this city
          </a>
          <button type="button" onClick={locate} aria-label="Find my location" className="flex size-[50px] items-center justify-center rounded-full bg-background shadow-md">
            <Icon icon={Gps01Icon} size={22} />
          </button>
        </div>
        <FilterChips
          filters={filters}
          friends={friends}
          showFriends={signedIn}
          floating
          onChange={(next) => {
            storeFilters(next.filters);
            setFilters(next.filters);
            setFriends(next.friends);
          }}
        />
        {(moved || tooWide || loading) && (
          <div className="flex justify-center">
            {tooWide ? (
              <span className="rounded-full bg-background px-4 py-2 text-sm font-extrabold shadow-md">Zoom in to see places</span>
            ) : loading ? (
              <span className="rounded-full bg-background px-4 py-2 text-sm font-extrabold shadow-md">Loading…</span>
            ) : (
              <button type="button" onClick={() => void load()} className="min-h-10 rounded-full bg-foreground px-4 text-sm font-extrabold text-background shadow-md">
                Search this area
              </button>
            )}
          </div>
        )}
      </div>

      <div className={cn("absolute right-3 left-3 z-10 flex items-end justify-between gap-2", current ? "bottom-[118px]" : "bottom-4")}>
        <div className="flex gap-2.5 rounded-full bg-background/92 px-2.5 py-1.5 text-xs font-extrabold" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-success" />
            Verified
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border-2 border-warning-strong bg-white" />
            Checking
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-muted-foreground" />
            Not checked
          </span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setListOpen((open) => !open)} className="hidden min-h-10 items-center gap-2 rounded-full bg-background px-4 text-sm font-extrabold shadow-md md:inline-flex">
            {places.length} places
          </button>
          <a href={listHref} className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-extrabold text-background">
            List
            <Icon icon={ListViewIcon} size={16} />
          </a>
        </div>
      </div>

      {current && (
        <section aria-label="Selected place" aria-live="polite" className="absolute right-3 bottom-3 left-3 z-20 mx-auto flex max-w-md items-center gap-3 rounded-[20px] bg-background p-3 shadow-2xl">
          <PlaceArt name={current.name} seed={current.id} src={photoUrl(current.photoKey)} className="size-16" rounded="rounded-[14px]" textSize="text-lg" />
          <a href={`/place/${current.id}`} className="grid min-w-0 flex-1 gap-1 text-foreground">
            <span className="truncate text-base font-extrabold">{current.name}</span>
            <span className="truncate text-[13px] font-semibold text-muted-foreground">
              {[current.cuisine, current.area, formatDistance(current.distanceKm)].filter(Boolean).join(" · ")}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill status={current.status} />
              {current.friend && <span className="text-xs font-bold text-foreground/85">{current.friend.line}</span>}
            </span>
          </a>
          <a href={`/place/${current.id}`} aria-label={`Open ${current.name}`} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary">
            <Icon icon={ArrowRight01Icon} />
          </a>
        </section>
      )}

      {listOpen && (
        <aside className="absolute top-36 right-3 bottom-16 z-20 hidden w-96 overflow-y-auto rounded-[20px] bg-background px-4 shadow-2xl md:block">
          <ul>
            {places.map((place) => (
              <PlaceRow key={place.id} place={place} signedIn={signedIn} compact />
            ))}
          </ul>
          {!places.length && <p className="py-8 text-center text-sm text-muted-foreground">No places in this area.</p>}
          <button type="button" className={buttonClass("ghost", "sm", "my-2 w-full")} onClick={() => setListOpen(false)}>
            Close
          </button>
        </aside>
      )}
    </div>
  );
}
