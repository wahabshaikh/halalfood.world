"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Cancel01Icon, Gps01Icon, GridViewIcon, MapsIcon, MinusSignIcon, Search01Icon, StarIcon } from "@hugeicons/core-free-icons";
import type { Map as MapInstance, Marker } from "maplibre-gl";
import type { Place } from "../../src/lib/places";
import type { DiscoveredPlace } from "../../src/lib/discovery";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  parseDiscoveryFilters,
  serializeDiscoveryFilters,
  type DiscoveryFilters,
} from "@halalfood/core/discovery-filters";
import MapFilters from "../map-filters";
import { Button } from "@halalfood/ui/components/button";
import { TextLink } from "../../src/components/blocks";
import { PlaceTile } from "../../src/components/place-tile";
import { PlacePhoto } from "../../src/components/place-photo";
import SavePlaceButton from "../../src/components/save-place-button";
import {
  DEFAULT_MAP_VIEW,
  deepLinkKind,
  shouldLoadViewport,
} from "@halalfood/core/map-viewport";
import { cn } from "@halalfood/ui/lib/utils";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

type Results = { places: DiscoveredPlace[]; total: number; limit: number };

const VIEWPORT_LIMIT = 600;
/** Markers beyond this many become plain dots so the map stays readable. */
const LABELLED_MARKERS = 120;

/** Query keys owned by the discovery filters, cleared before each rewrite. */
const FILTER_PARAMS = [
  "status",
  "facts",
  "cuisine",
  "dish",
  "price",
  "service",
  "meal",
  "open",
  "within",
  "sort",
  "mine",
];

function locality(place: Place) {
  return place.address_locality || place.city_slug.replace(/-/g, " ");
}

function viewFromParams(params: URLSearchParams) {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const zoom = Number(params.get("z"));
  if (
    !params.get("lat") ||
    !params.get("lng") ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return {
    center: [lng, lat] as [number, number],
    zoom: Number.isFinite(zoom) && zoom >= 1 && zoom <= 20 ? zoom : 14,
  };
}

function markerLabel(place: Place) {
  const rating = Number(place.rating_value);
  return Number.isFinite(rating) && rating > 0 ? "★ " + rating.toFixed(1) : "";
}

function SelectedCard({ place, onClose }: { place: Place; onClose: () => void }) {
  return (
    <section
      className="absolute bottom-5 left-1/2 z-4 grid w-[min(420px,calc(100%-32px))] -translate-x-1/2 grid-cols-[130px_minmax(0,1fr)] overflow-hidden rounded-2xl bg-background shadow-2xl min-[900px]:bottom-7"
      aria-label="Selected place"
      aria-live="polite"
    >
      <a href={"/place/" + encodeURIComponent(place.id)} tabIndex={-1} aria-hidden="true">
        <PlacePhoto seed={place.id} name={place.name} className="aspect-auto! h-full rounded-none" />
      </a>
      <div className="relative grid gap-0.5 py-3.5 pr-10 pl-3.5 text-[13px] text-muted-foreground">
        <Button
          variant="outline"
          size="icon"
          className="absolute top-2.5 right-2.5 rounded-full shadow-sm"
          aria-label="Close"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
        </Button>
        <strong className="text-base text-foreground">
          <a href={"/place/" + encodeURIComponent(place.id)} className="hover:underline">
            {place.name}
          </a>
        </strong>
        <span>{locality(place)}</span>
        <span>{place.street_address}</span>
        {place.rating_value && (
          <span className="flex items-center gap-1">
            <HugeiconsIcon icon={StarIcon} size={12} fill="currentColor" aria-hidden="true" />{" "}
            {place.rating_value} on Google
          </span>
        )}
        <div className="mt-1.5 flex items-center gap-3">
          <TextLink href={"/place/" + encodeURIComponent(place.id)} className="text-sm">
            See the place
          </TextLink>
          <SavePlaceButton placeId={place.id} compact />
        </div>
      </div>
    </section>
  );
}

export default function MapView({
  initialView = null,
}: {
  /** Where the visitor probably is, chosen on the server. URL params still win. */
  initialView?: { center: [number, number]; zoom: number } | null;
} = {}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const library = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const styleReady = useRef(false);
  const ignoreMove = useRef(false);
  const [ready, setReady] = useState(false);
  const [results, setResults] = useState<Results>({ places: [], total: 0, limit: VIEWPORT_LIMIT });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Place | null>(null);
  // Filters start empty so the server HTML matches the first client render.
  // Reading the URL here would press a different button on the client and
  // fail hydration (React error 418) on every shared filter link.
  const [filters, setFilters] = useState<DiscoveryFilters>(EMPTY_FILTERS);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  // Set once a city or place link has finished moving the camera.
  const [deepLinkSettled, setDeepLinkSettled] = useState(false);
  // Panning only offers a refresh, so results never swap out mid-browse.
  const [areaMoved, setAreaMoved] = useState(false);
  const [searchArea, setSearchArea] = useState(0);
  const [showList, setShowList] = useState(false);
  const [retry, setRetry] = useState(0);

  const syncUrl = useCallback((placeId: string | null) => {
    const url = new URL(window.location.href);
    for (const key of ["city", "lat", "lng", "z"]) url.searchParams.delete(key);
    if (placeId) url.searchParams.set("place", placeId);
    else url.searchParams.delete("place");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  const selectPlace = useCallback(
    (place: Place, options: { fly?: boolean } = {}) => {
      setSelected(place);
      setShowList(false);
      syncUrl(place.id);
      if (options.fly !== false && map.current)
        map.current.flyTo({
          duration: 700,
          center: [place.lng, place.lat],
          zoom: Math.max(map.current.getZoom(), 14),
        });
    },
    [syncUrl],
  );

  useEffect(() => {
    setFilters(parseDiscoveryFilters(new URLSearchParams(window.location.search)));
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    const url = new URL(window.location.href);
    for (const key of FILTER_PARAMS) url.searchParams.delete(key);
    for (const [key, value] of new URLSearchParams(serializeDiscoveryFilters(filters)))
      url.searchParams.set(key, value);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [filters, filtersHydrated]);

  const closeSelected = useCallback(() => {
    setSelected(null);
    syncUrl(null);
  }, [syncUrl]);

  useEffect(() => {
    let cancelled = false;
    const view =
      viewFromParams(new URLSearchParams(window.location.search)) ||
      initialView ||
      DEFAULT_MAP_VIEW;
    import("maplibre-gl")
      .then((lib) => {
        if (cancelled || !container.current) return;
        lib.setWorkerUrl(mapWorkerUrl);
        library.current = lib;
        const instance = new lib.Map({
          container: container.current,
          style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
          center: view.center,
          zoom: view.zoom,
          attributionControl: { compact: true },
        });
        map.current = instance;
        instance.on("load", () => {
          styleReady.current = true;
          setReady(true);
        });
        // A single tile or sprite can fail while the map still loads, so only
        // complain if the style never finishes loading.
        let errorTimer: ReturnType<typeof setTimeout> | undefined;
        instance.on("error", () => {
          if (styleReady.current || errorTimer) return;
          errorTimer = setTimeout(() => {
            if (!styleReady.current && !cancelled)
              setNotice("The map couldn’t load. Please reload the page.");
          }, 8000);
        });
      })
      .catch(() => {
        setNotice("The map could not start. Please reload the page.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      library.current = null;
      styleReady.current = false;
    };
  }, []);

  const moveMap = useCallback((center: [number, number], zoom: number) => {
    const instance = map.current;
    if (!instance) return;
    // jumpTo emits moveend. Ignore that one so a deep link does not ask the
    // person to search an area the link already chose.
    ignoreMove.current = true;
    instance.jumpTo({ center, zoom });
    instance.once("moveend", () => {
      queueMicrotask(() => {
        ignoreMove.current = false;
      });
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const kind = deepLinkKind(params);
    if (!kind) return;
    const controller = new AbortController();
    (async () => {
      try {
        switch (kind) {
          case "place": {
            const placeId = params.get("place") || "";
            const response = await fetch("/api/places/" + encodeURIComponent(placeId), {
              signal: controller.signal,
            });
            if (!response.ok) throw new Error();
            const place = (await response.json()) as Place;
            if (typeof place.lat !== "number" || typeof place.lng !== "number") throw new Error();
            moveMap([place.lng, place.lat], 15);
            selectPlace(place, { fly: false });
            break;
          }
          case "city": {
            const citySlug = params.get("city") || "";
            const response = await fetch("/api/cities/" + encodeURIComponent(citySlug), {
              signal: controller.signal,
            });
            if (!response.ok) throw new Error();
            const city = (await response.json()) as {
              center_lat: number | null;
              center_lng: number | null;
            };
            if (city.center_lat === null || city.center_lng === null) throw new Error();
            moveMap([city.center_lng, city.center_lat], 12);
            break;
          }
          default: {
            const unreachable: never = kind;
            throw new Error(`Unexpected map link: ${unreachable}`);
          }
        }
        setDeepLinkSettled(true);
      } catch (caught) {
        if ((caught as Error).name === "AbortError") return;
        setNotice("That link couldn’t be opened, so here’s the map instead.");
        setDeepLinkSettled(true);
      }
    })();
    return () => controller.abort();
  }, [ready, selectPlace, moveMap]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const kind = deepLinkKind(new URLSearchParams(window.location.search));
    if (!shouldLoadViewport(kind, deepLinkSettled)) return;
    const instance = map.current;
    let controller: AbortController | undefined;
    async function loadPlaces() {
      controller?.abort();
      controller = new AbortController();
      setLoading(true);
      setError("");
      setAreaMoved(false);
      const bounds = instance.getBounds();
      const wrap = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;
      const world = bounds.getEast() - bounds.getWest() >= 360;
      const bbox = [
        world ? -180 : wrap(bounds.getWest()),
        Math.max(-90, bounds.getSouth()),
        world ? 180 : wrap(bounds.getEast()),
        Math.min(90, bounds.getNorth()),
      ];
      try {
        const query = serializeDiscoveryFilters(filters);
        const response = await fetch(
          "/api/discover?bbox=" +
            bbox.join(",") +
            "&limit=" +
            VIEWPORT_LIMIT +
            (query ? "&" + query : ""),
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Places couldn’t load.");
        setResults(await response.json());
        setLoading(false);
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") {
          setError((caught as Error).message);
          setResults({ places: [], total: 0, limit: VIEWPORT_LIMIT });
          setLoading(false);
        }
      }
    }
    const markMoved = () => {
      if (ignoreMove.current) return;
      setAreaMoved(true);
    };
    instance.on("moveend", markMoved);
    void loadPlaces();
    return () => {
      controller?.abort();
      instance.off("moveend", markMoved);
    };
  }, [ready, deepLinkSettled, retry, filters, searchArea]);

  const visible = results.places;

  useEffect(() => {
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    if (!ready || !map.current || !library.current) return;
    const lib = library.current;
    markers.current = visible.map((place, index) => {
      const element = document.createElement("button");
      element.type = "button";
      const label = index < LABELLED_MARKERS ? markerLabel(place) : "";
      element.className = cn(
        "inline-flex items-center gap-1 rounded-full border border-black/10 bg-background px-2.5 py-1.5 font-sans text-[13px] font-extrabold whitespace-nowrap text-foreground shadow-md transition-transform hover:z-3 hover:scale-110 data-[selected=true]:scale-110 data-[selected=true]:bg-foreground data-[selected=true]:text-background",
        !label && "size-7.5 justify-center p-0",
      );
      if (selected?.id === place.id) element.dataset.selected = "true";
      element.textContent = label || "•";
      element.setAttribute("aria-label", place.name);
      element.title = place.name;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        selectPlace(place);
      });
      return new lib.Marker({ element }).setLngLat([place.lng, place.lat]).addTo(map.current!);
    });
    // `visible` is derived from results + filter on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.places, ready, selected?.id, selectPlace]);

  function locate() {
    if (!navigator.geolocation) {
      setNotice("This browser can’t share your location. Try searching for a city.");
      return;
    }
    setNotice("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.current?.flyTo({
          duration: 700,
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 14,
        });
        setNotice("");
      },
      (positionError) =>
        setNotice(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Location is turned off. Try searching for your city."
            : "We couldn’t find you. Try searching for your city.",
        ),
      { timeout: 10000 },
    );
  }

  const heading = loading
    ? "Finding places…"
    : error
      ? "Places unavailable"
      : results.total.toLocaleString() + (results.total === 1 ? " place" : " places") + " in this area";
  const filterCount = activeFilterCount(filters);

  return (
    <div className="relative grid grid-cols-1 min-[900px]:h-[calc(100vh-79px)] min-[900px]:grid-cols-[minmax(380px,44%)_minmax(0,1fr)]">
      <section
        className={cn(
          "overflow-y-auto px-4.5 pt-5 pb-24 md:px-6 min-[900px]:block min-[900px]:pb-10",
          !showList && "hidden",
        )}
        aria-label="Places in this area"
      >
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h1 className="text-lg">{heading}</h1>
          {results.total > results.limit && !loading && (
            <p className="text-sm text-muted-foreground">Zoom in to see them all</p>
          )}
        </div>
        <div className="mb-4.5">
          <MapFilters filters={filters} onChange={setFilters} />
        </div>
        {error && (
          <MapStatus>
            {error}
            <Button variant="link" onClick={() => setRetry((value) => value + 1)}>
              Try again
            </Button>
          </MapStatus>
        )}
        {!loading && !error && !visible.length && (
          <MapStatus>
            {filterCount
              ? "No places here match these filters. Widen them or move the map and search again."
              : "No places here yet. Try moving the map or zooming out."}
            {filterCount > 0 && (
              <Button variant="link" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            )}
          </MapStatus>
        )}
        {!error && (
          <ul className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {visible.slice(0, 60).map((place) => (
              <li
                key={place.id}
                onMouseEnter={() => {
                  const marker = markers.current[visible.indexOf(place)];
                  marker?.getElement().setAttribute("data-selected", "true");
                }}
                onMouseLeave={() => {
                  const marker = markers.current[visible.indexOf(place)];
                  if (selected?.id !== place.id) marker?.getElement().removeAttribute("data-selected");
                }}
              >
                <PlaceTile place={place} status={place.halal_status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div
        className={cn(
          "relative h-[calc(100vh-150px)] min-[900px]:block min-[900px]:h-auto",
          showList && "hidden",
        )}
      >
        <div ref={container} className="absolute inset-0 bg-map" aria-label="Map of halal places" />
        <div className="absolute top-4 right-4 z-3 grid gap-2.5" aria-label="Map controls">
          <ButtonGroupVertical>
            <Button variant="ghost" size="icon-lg" className="rounded-none" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
              <HugeiconsIcon icon={Add01Icon} size={18} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-lg" className="rounded-none border-t" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
              <HugeiconsIcon icon={MinusSignIcon} size={18} aria-hidden="true" />
            </Button>
          </ButtonGroupVertical>
          <ButtonGroupVertical>
            <Button variant="ghost" size="icon-lg" className="rounded-none" aria-label="Find my location" onClick={locate}>
              <HugeiconsIcon icon={Gps01Icon} size={18} aria-hidden="true" />
            </Button>
          </ButtonGroupVertical>
        </div>
        {notice && (
          <div
            className="absolute top-4 left-1/2 z-5 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-background px-4 py-2.5 text-sm font-bold shadow-lg"
            role="status"
          >
            <span>{notice}</span>
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setNotice("")}>
              <HugeiconsIcon icon={Cancel01Icon} size={15} aria-hidden="true" />
            </Button>
          </div>
        )}
        {areaMoved && !loading && (
          <Button
            variant="outline"
            className="absolute top-4 left-1/2 z-3 h-10 -translate-x-1/2 rounded-full border-0 px-4 font-extrabold shadow-lg"
            onClick={() => setSearchArea((value) => value + 1)}
          >
            <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={2.6} aria-hidden="true" />
            Search this area
          </Button>
        )}
        {selected && <SelectedCard place={selected} onClose={closeSelected} />}
      </div>

      <button
        type="button"
        className="fixed bottom-24 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-5 py-3.5 text-sm font-extrabold text-background shadow-lg min-[900px]:hidden"
        onClick={() => setShowList((value) => !value)}
      >
        {showList ? (
          <>
            Show map <HugeiconsIcon icon={MapsIcon} size={16} aria-hidden="true" />
          </>
        ) : (
          <>
            Show list <HugeiconsIcon icon={GridViewIcon} size={16} aria-hidden="true" />
          </>
        )}
      </button>
    </div>
  );
}

function MapStatus({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-secondary p-4 text-sm text-muted-foreground [&_button]:h-auto [&_button]:px-1.5 [&_button]:py-0 [&_button]:font-extrabold [&_button]:text-foreground [&_button]:underline">
      {children}
    </p>
  );
}

function ButtonGroupVertical({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid overflow-hidden rounded-xl bg-background shadow-md">{children}</div>
  );
}
