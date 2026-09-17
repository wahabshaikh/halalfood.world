"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  LocateFixed,
  Maximize,
  MapPinned,
  Minus,
  Plus,
  Search,
  SearchCheck,
  Star,
  Trophy,
  Utensils,
  X,
} from "lucide-react";
import type { Map as MapInstance, Marker } from "maplibre-gl";
import type { DiscoveredPlace } from "../src/lib/discovery";
import type { Place } from "../src/lib/places";
import {
  EMPTY_FILTERS,
  parseDiscoveryFilters,
  serializeDiscoveryFilters,
  type DiscoveryFilters,
} from "../src/lib/discovery-filters";
import { STATUS_COPY } from "../src/lib/halal-taxonomy";
import MapFilters from "./map-filters";
import SavePlaceButton from "../src/components/save-place-button";
import { Button } from "../src/components/ui/button";
import { cn } from "../src/lib/utils";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

type Results = { places: DiscoveredPlace[]; total: number; limit: number };
type SheetState = "collapsed" | "half" | "expanded";

const VIEWPORT_LIMIT = 600;
const DEFAULT_VIEW = { center: [72.8777, 19.055] as [number, number], zoom: 14 };

const foodIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v18M18 3c-3 3-3 8 0 8h2M20 3v18"/></svg>';

function BrandGlyph() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="23" height="23" viewBox="0 0 28 28" fill="none">
        <path
          d="M14 25.2s7.6-7.2 7.6-13.1A7.6 7.6 0 1 0 6.4 12.1C6.4 18 14 25.2 14 25.2Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <circle cx="14" cy="11.8" r="3.1" stroke="currentColor" strokeWidth="1.7" />
        <path d="M10.3 11.8h7.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function address(place: Place) {
  return [place.street_address, place.address_locality, place.address_country]
    .filter(Boolean)
    .join(", ");
}

function cityLabel(place: Place) {
  return place.address_locality || place.city_slug.replace(/-/g, " ");
}

function safeWebsite(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function viewFromParams(params: URLSearchParams) {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const zoom = Number(params.get("z"));
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    !params.get("lat") ||
    !params.get("lng")
  )
    return null;
  return {
    center: [lng, lat] as [number, number],
    zoom: Number.isFinite(zoom) && zoom >= 1 && zoom <= 20 ? zoom : 14,
  };
}

/** The trust signals a card carries: status, evidence, and real return intent. */
function TrustMeta({ place }: { place: DiscoveredPlace }) {
  const copy = STATUS_COPY[place.halal_status];
  return (
    <span className="card-trust">
      <span className={`card-status tone-${copy.tone}`}>{copy.label}</span>
      {place.evidence_count > 0 && (
        <span className="card-evidence">
          {place.evidence_count} evidence {place.evidence_count === 1 ? "item" : "items"}
        </span>
      )}
      {place.would_return_percent !== null ? (
        <span className="card-return">
          {place.would_return_percent}% would return · {place.check_in_count} check-ins
        </span>
      ) : place.check_in_count > 0 ? (
        <span className="card-return is-thin">
          {place.check_in_count} {place.check_in_count === 1 ? "check-in" : "check-ins"} —
          too few to publish a percentage
        </span>
      ) : null}
      {place.distance_km !== null && (
        <span className="card-distance">{place.distance_km.toFixed(1)} km</span>
      )}
    </span>
  );
}

function PlaceCard({
  place,
  selected,
  onSelect,
}: {
  place: DiscoveredPlace;
  selected: boolean;
  onSelect: (place: Place) => void;
}) {
  return (
    <article className={cn("map-place-card", selected && "is-selected")}>
      <button
        type="button"
        className="map-place-card-main"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(place)}
      >
        <span className="place-card-visual map-card-visual" aria-hidden="true">
          <Utensils size={22} strokeWidth={1.5} />
        </span>
        <span className="map-place-card-copy">
          <span className="map-place-card-title">{place.name}</span>
          <span className="map-place-card-subtitle">{address(place)}</span>
          <span className="map-place-card-meta">
            <span>{cityLabel(place)}</span>
            {place.price_band !== null && <span>{"$".repeat(place.price_band)}</span>}
          </span>
          <TrustMeta place={place} />
        </span>
      </button>
      <span className="map-place-card-save">
        <SavePlaceButton placeId={place.id} compact />
      </span>
      <a className="map-place-card-link" href={"/place/" + place.id}>
        View details <ArrowUpRight size={13} aria-hidden="true" />
      </a>
    </article>
  );
}

function PlacePreview({
  place,
  onClose,
}: {
  place: Place;
  onClose: () => void;
}) {
  const website = safeWebsite(place.website);
  return (
    <section className="selected-preview" aria-label="Selected restaurant" aria-live="polite">
      <div className="selected-preview-head">
        <div>
          <p className="eyebrow">SELECTED PLACE</p>
          <h2>{place.name}</h2>
        </div>
        <button
          type="button"
          className="selected-preview-close"
          aria-label="Close selected place"
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <p className="selected-preview-address">{address(place)}</p>
      <div className="selected-preview-meta">
        <span>{cityLabel(place)}</span>
        {place.rating_value && (
          <span>
            <Star className="star" size={12} fill="currentColor" aria-hidden="true" />{" "}
            {place.rating_value}
          </span>
        )}
      </div>
      <div className="selected-preview-actions">
        <a href={"/place/" + place.id}>
          View restaurant <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        {place.telephone && (
          <a href={"tel:" + place.telephone.replace(/[^+\d]/g, "")}>Call</a>
        )}
        {website && (
          <a href={website} target="_blank" rel="noopener noreferrer nofollow">
            Website
          </a>
        )}
        <SavePlaceButton placeId={place.id} compact />
      </div>
    </section>
  );
}

function SearchBox({
  query,
  setQuery,
  open,
  setOpen,
  results,
  state,
  onSelect,
}: {
  query: string;
  setQuery: (value: string) => void;
  open: boolean;
  setOpen: (value: boolean) => void;
  results: Place[];
  state: string;
  onSelect: (place: Place) => void;
}) {
  return (
    <div className="map-search-wrap">
      <form
        className="map-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (results[0]) onSelect(results[0]);
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input
          aria-label="Search for halal food"
          placeholder="Search a place or city"
          value={query}
          maxLength={120}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </form>
      {open && query && (
        <div className="map-search-results">
          {state && <p role="status">{state}</p>}
          {results.map((place) => (
            <button
              type="button"
              className="map-search-result"
              key={place.id}
              onClick={() => onSelect(place)}
            >
              <span className="map-search-result-icon">
                <Utensils size={15} aria-hidden="true" />
              </span>
              <span className="map-search-result-copy">
                <strong>{place.name}</strong>
                <small>{address(place)}</small>
              </span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FoodMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const library = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const styleReady = useRef(false);
  const [ready, setReady] = useState(false);
  const [results, setResults] = useState<Results>({
    places: [],
    total: 0,
    limit: VIEWPORT_LIMIT,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [searchState, setSearchState] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  // Filters are seeded from and written back to the URL, so a filtered view is
  // shareable and survives a reload.
  const [filters, setFilters] = useState<DiscoveryFilters>(() =>
    typeof window === "undefined"
      ? EMPTY_FILTERS
      : parseDiscoveryFilters(new URLSearchParams(window.location.search)),
  );
  // The viewport is only re-queried when the person asks, so panning the map
  // never silently swaps the results out from under them.
  const [areaMoved, setAreaMoved] = useState(false);
  const [searchArea, setSearchArea] = useState(0);
  const [sheetState, setSheetState] = useState<SheetState>("collapsed");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    const next = new URLSearchParams(serializeDiscoveryFilters(filters));
    for (const key of [
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
    ])
      url.searchParams.delete(key);
    for (const [key, value] of next) url.searchParams.set(key, value);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [filters]);

  const syncUrl = useCallback((placeId: string | null) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("city");
    url.searchParams.delete("lat");
    url.searchParams.delete("lng");
    url.searchParams.delete("z");
    if (placeId) url.searchParams.set("place", placeId);
    else url.searchParams.delete("place");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  const selectPlace = useCallback(
    (place: Place, options: { fly?: boolean } = {}) => {
      setSelected(place);
      setSearchOpen(false);
      setSheetState("collapsed");
      setQuery("");
      syncUrl(place.id);
      if (options.fly !== false && map.current) {
        map.current.flyTo({
          duration: 700,
          center: [place.lng, place.lat],
          zoom: Math.max(map.current.getZoom(), 13),
        });
      }
    },
    [syncUrl],
  );

  const closeSelected = useCallback(() => {
    setSelected(null);
    syncUrl(null);
  }, [syncUrl]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const view = viewFromParams(params) || DEFAULT_VIEW;
    import("maplibre-gl")
      .then((lib) => {
        if (cancelled || !container.current) return;
        lib.setWorkerUrl(mapWorkerUrl);
        library.current = lib;
        const instance = new lib.Map({
          container: container.current,
          style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
          center: view.center,
          zoom: view.zoom,
          attributionControl: { compact: true },
        });
        map.current = instance;
        instance.on("load", () => {
          styleReady.current = true;
          setReady(true);
          setMapError("");
        });
        instance.on("error", () => {
          if (!styleReady.current) setMapError("The basemap could not load.");
        });
      })
      .catch(() => {
        setMapError("The map could not start. Please reload the page.");
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

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const placeId = params.get("place");
    const citySlug = params.get("city");
    if (!placeId && !citySlug) return;
    const controller = new AbortController();
    (async () => {
      try {
        if (placeId) {
          const response = await fetch("/api/places/" + encodeURIComponent(placeId), {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error();
          const place = (await response.json()) as Place;
          if (typeof place.lat !== "number" || typeof place.lng !== "number") throw new Error();
          map.current?.jumpTo({ center: [place.lng, place.lat], zoom: 15 });
          selectPlace(place, { fly: false });
          return;
        }
        const response = await fetch("/api/cities/" + encodeURIComponent(citySlug || ""), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const city = (await response.json()) as {
          center_lat: number | null;
          center_lng: number | null;
        };
        if (city.center_lat === null || city.center_lng === null) throw new Error();
        map.current?.jumpTo({ center: [city.center_lng, city.center_lat], zoom: 12 });
      } catch (caught) {
        if ((caught as Error).name !== "AbortError")
          setNotice("That link could not be opened. Showing the map instead.");
      }
    })();
    return () => controller.abort();
  }, [ready, selectPlace]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    let controller: AbortController | undefined;
    async function loadPlaces() {
      controller?.abort();
      controller = new AbortController();
      setLoading(true);
      setError("");
      // Clear the offer as the load starts, not when it finishes: a response
      // that lands after the person has already panned must not swallow their
      // next "search this area".
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
        if (!response.ok) throw new Error("Places could not load. Please try again.");
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
    // Moving the map only offers a refresh; it never performs one. Changing a
    // filter does re-query immediately, because that is an explicit request.
    const markMoved = () => setAreaMoved(true);
    instance.on("moveend", markMoved);
    void loadPlaces();
    return () => {
      controller?.abort();
      instance.off("moveend", markMoved);
    };
  }, [ready, retry, filters, searchArea]);

  useEffect(() => {
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    if (!ready || !map.current || !library.current) return;
    markers.current = results.places.map((place) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = cn("food-marker", selected?.id === place.id && "is-selected");
      element.innerHTML = foodIcon;
      element.setAttribute("aria-label", place.name);
      element.title = place.name;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        selectPlace(place);
      });
      return new library.current!.Marker({ element })
        .setLngLat([place.lng, place.lat])
        .addTo(map.current!);
    });
  }, [results.places, ready, selected?.id, selectPlace]);

  useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    setSearchResults([]);
    if (term.length < 2) {
      setSearchState(term ? "Keep typing" : "");
      return;
    }
    setSearchState("Searching...");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          "/api/places/search?q=" + encodeURIComponent(term) + "&limit=12",
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const data = (await response.json()) as Results;
        setSearchResults(data.places);
        setSearchState(
          data.places.length ? "" : "No halal places match that search.",
        );
      } catch (caught) {
        if ((caught as Error).name !== "AbortError")
          setSearchState("Search could not load. Please try again.");
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function locate() {
    if (!navigator.geolocation) {
      setNotice("This browser cannot share your location. Search for a city instead.");
      return;
    }
    setNotice("Finding your location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.current?.flyTo({
          duration: 700,
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 13,
        });
        setNotice("");
      },
      (positionError) =>
        setNotice(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Location permission is off. Search for your city instead."
            : "We could not find your location. Search for your city instead.",
        ),
      { timeout: 10000 },
    );
  }

  const visiblePlaces = results.places;
  const countLabel = loading
    ? "Finding places..."
    : error
      ? "Places unavailable"
      : results.total.toLocaleString() + (results.total === 1 ? " place" : " places");

  function cycleSheet() {
    setSheetState((current) =>
      current === "collapsed" ? "half" : current === "half" ? "expanded" : "collapsed",
    );
  }

  const filterRow = <MapFilters filters={filters} onChange={setFilters} />;

  return (
    <main className="map-app">
      <div ref={container} className="map-canvas" aria-label="Map of halal food places" />

      <aside className="explore-rail" aria-label="Halalfood exploration panel">
        <div className="rail-header">
          <a className="map-brand" href="/" aria-label="Halalfood home">
            <BrandGlyph />
            <span>Halalfood</span>
          </a>
          <div className="rail-header-actions">
            <a className="header-contribute" href="/add">Contribute</a>
          </div>
        </div>
        <div className="rail-scroll">
          <div className="rail-intro">
            <p className="eyebrow">THE COMMUNITY FOOD MAP</p>
            <h1>Find a table worth sharing.</h1>
            <p>Explore halal places, then leave the next useful detail for someone else.</p>
          </div>
          <SearchBox
            query={query}
            setQuery={setQuery}
            open={searchOpen}
            setOpen={setSearchOpen}
            results={searchResults}
            state={searchState}
            onSelect={selectPlace}
          />
          {filterRow}
          {selected && <PlacePreview place={selected} onClose={closeSelected} />}
          <div className="results-heading">
            <div>
              <p className="eyebrow">IN THIS VIEW</p>
              <h2>{countLabel}</h2>
            </div>
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
              Reset filters
            </button>
          </div>
          <div className="map-place-list">
            {loading && <p className="map-place-status">Loading places...</p>}
            {error && (
              <p className="map-place-status">
                {error}{" "}
                <button type="button" className="inline-retry" onClick={() => setRetry((value) => value + 1)}>
                  Retry
                </button>
              </p>
            )}
            {!loading && !error && !visiblePlaces.length && (
              <p className="map-place-status">
                No places in this view match these filters. Widen the filters or
                move the map and search again.
              </p>
            )}
            {!error &&
              visiblePlaces.map((place) => (
                <PlaceCard
                  key={place.id}
                  place={place}
                  selected={selected?.id === place.id}
                  onSelect={selectPlace}
                />
              ))}
          </div>
        </div>
      </aside>

      <div className="mobile-map-chrome">
        <a className="mobile-brand" href="/" aria-label="Halalfood home">
          <BrandGlyph />
          <span>Halalfood</span>
        </a>
        <div className="mobile-map-actions">
          <a className="mobile-icon-button" href="/add" aria-label="Contribute">
            <Plus size={18} aria-hidden="true" />
          </a>
          <a className="mobile-icon-button" href="/saved" aria-label="Saved places">
            <span aria-hidden="true">♡</span>
          </a>
        </div>
      </div>

      <div className="mobile-search-wrap">
        <SearchBox
          query={query}
          setQuery={setQuery}
          open={searchOpen}
          setOpen={setSearchOpen}
          results={searchResults}
          state={searchState}
          onSelect={selectPlace}
        />
      </div>

      {(error || mapError || notice) && (
        <div className="map-toast" role="status">
          <span>{error || mapError || notice}</span>
          {error ? (
            <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>
          ) : (
            <button type="button" aria-label="Dismiss" onClick={() => setNotice("")}>
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="map-controls" aria-label="Map controls">
        <div className="zoom-controls">
          <button type="button" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
            <Plus size={18} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
            <Minus size={18} aria-hidden="true" />
          </button>
        </div>
        <button type="button" aria-label="Find my location" onClick={locate}>
          <LocateFixed size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Toggle fullscreen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else if (document.documentElement.requestFullscreen)
              void document.documentElement.requestFullscreen().catch(() => setNotice("Fullscreen is unavailable."));
            else setNotice("Fullscreen is unavailable.");
          }}
        >
          <Maximize size={18} aria-hidden="true" />
        </button>
      </div>

      {areaMoved && !loading && (
        <button
          type="button"
          className="search-this-area"
          onClick={() => setSearchArea((value) => value + 1)}
        >
          <SearchCheck size={16} aria-hidden="true" />
          Search this area
        </button>
      )}

      <span className="map-bottom-note">Halal listings · Community maintained</span>

      <section className={cn("mobile-results-sheet", "sheet-" + sheetState)} aria-label="Places in this area">
        <button type="button" className="sheet-handle" aria-label="Change results sheet size" onClick={cycleSheet} />
        <div className="sheet-summary">
          <div className="sheet-summary-copy">
            <p className="eyebrow">{selected ? "SELECTED PLACE" : "EXPLORE THIS AREA"}</p>
            <h2>{selected ? selected.name : countLabel}</h2>
            <p>{selected ? cityLabel(selected) : "Move the map to discover more"}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="sheet-expand"
            onClick={cycleSheet}
          >
            {sheetState === "expanded" ? "Collapse" : "See places"}
          </Button>
        </div>
        {sheetState !== "collapsed" && (
          <MapFilters filters={filters} onChange={setFilters} mobile />
        )}
        {selected && sheetState === "collapsed" && (
          <div className="mobile-selected-preview">
            <PlacePreview place={selected} onClose={closeSelected} />
          </div>
        )}
        {sheetState !== "collapsed" && (
          <div className="mobile-results-list">
            {loading && <p className="map-place-status">Loading places...</p>}
            {error && <p className="map-place-status">{error}</p>}
            {!loading && !error && !visiblePlaces.length && (
              <p className="map-place-status">
                No places in this view match these filters.
              </p>
            )}
            {!error &&
              visiblePlaces.map((place) => (
                <PlaceCard
                  key={place.id}
                  place={place}
                  selected={selected?.id === place.id}
                  onSelect={selectPlace}
                />
              ))}
          </div>
        )}
      </section>
      <nav
        className={cn("mobile-bottom-nav", selected && sheetState === "collapsed" && "is-hidden")}
        aria-label="Mobile navigation"
      >
        <a className="is-active" href="/">
          <MapPinned size={17} aria-hidden="true" />
          <span>Explore</span>
        </a>
        <a href="/saved">
          <Bookmark size={17} aria-hidden="true" />
          <span>Saved</span>
        </a>
        <a className="mobile-bottom-nav-contribute" href="/add">
          <Plus size={17} aria-hidden="true" />
          <span>Contribute</span>
        </a>
        <a href="/leaderboard">
          <Trophy size={17} aria-hidden="true" />
          <span>Community</span>
        </a>
      </nav>
    </main>
  );
}