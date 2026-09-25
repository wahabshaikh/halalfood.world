"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, LocateFixed, Map as MapIcon, Minus, Plus, Star, X } from "lucide-react";
import type { Map as MapInstance, Marker } from "maplibre-gl";
import type { Place } from "../../src/lib/places";
import { PlaceTile } from "../../src/components/place-tile";
import { PlacePhoto } from "../../src/components/place-photo";
import SavePlaceButton from "../../src/components/save-place-button";
import { cn } from "../../src/lib/utils";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

type Results = { places: Place[]; total: number; limit: number };
type FilterKey = "all" | "top" | "contact";

const VIEWPORT_LIMIT = 600;
/** Markers beyond this many become plain dots so the map stays readable. */
const LABELLED_MARKERS = 120;
const DEFAULT_VIEW = { center: [72.8777, 19.055] as [number, number], zoom: 14 };

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All places" },
  { key: "top", label: "Rated 4.5+" },
  { key: "contact", label: "Has phone or website" },
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
    <section className="map-selected" aria-label="Selected place" aria-live="polite">
      <a href={"/place/" + encodeURIComponent(place.id)} tabIndex={-1} aria-hidden="true">
        <PlacePhoto seed={place.id} name={place.name} />
      </a>
      <div className="map-selected-body">
        <button type="button" className="icon-circle map-selected-close" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
        <strong>
          <a href={"/place/" + encodeURIComponent(place.id)}>{place.name}</a>
        </strong>
        <span>{locality(place)}</span>
        <span>{place.street_address}</span>
        {place.rating_value && (
          <span>
            <Star size={12} fill="currentColor" aria-hidden="true" /> {place.rating_value} on Google
          </span>
        )}
        <div className="map-selected-actions">
          <a href={"/place/" + encodeURIComponent(place.id)}>See the place</a>
          <SavePlaceButton placeId={place.id} compact />
        </div>
      </div>
    </section>
  );
}

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const library = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const styleReady = useRef(false);
  const [ready, setReady] = useState(false);
  const [results, setResults] = useState<Results>({ places: [], total: 0, limit: VIEWPORT_LIMIT });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Place | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
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

  const closeSelected = useCallback(() => {
    setSelected(null);
    syncUrl(null);
  }, [syncUrl]);

  useEffect(() => {
    let cancelled = false;
    const view = viewFromParams(new URLSearchParams(window.location.search)) || DEFAULT_VIEW;
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
        const city = (await response.json()) as { center_lat: number | null; center_lng: number | null };
        if (city.center_lat === null || city.center_lng === null) throw new Error();
        map.current?.jumpTo({ center: [city.center_lng, city.center_lat], zoom: 12 });
      } catch (caught) {
        if ((caught as Error).name !== "AbortError")
          setNotice("That link couldn’t be opened, so here’s the map instead.");
      }
    })();
    return () => controller.abort();
  }, [ready, selectPlace]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function loadPlaces() {
      controller?.abort();
      controller = new AbortController();
      setLoading(true);
      setError("");
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
        const response = await fetch("/api/places?bbox=" + bbox.join(",") + "&limit=" + VIEWPORT_LIMIT, {
          signal: controller.signal,
        });
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
    const schedule = () => {
      clearTimeout(timer);
      controller?.abort();
      timer = setTimeout(() => void loadPlaces(), 180);
    };
    instance.on("moveend", schedule);
    void loadPlaces();
    return () => {
      clearTimeout(timer);
      controller?.abort();
      instance.off("moveend", schedule);
    };
  }, [ready, retry]);

  const visible = results.places.filter((place) => {
    if (filter === "top") return Number(place.rating_value) >= 4.5;
    if (filter === "contact") return Boolean(place.telephone || place.website);
    return true;
  });

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
        "rating-marker",
        !label && "is-dot",
        selected?.id === place.id && "is-selected",
      );
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
  }, [results.places, filter, ready, selected?.id, selectPlace]);

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
      : filter === "all"
        ? results.total.toLocaleString() + (results.total === 1 ? " place" : " places") + " in this area"
        : visible.length.toLocaleString() + " shown";

  return (
    <div className={cn("map-page", showList && "show-list")}>
      <section className="map-list" aria-label="Places in this area">
        <div className="map-list-head">
          <h1>{heading}</h1>
          {results.total > results.limit && !loading && <p>Zoom in to see them all</p>}
        </div>
        <div className="map-filters" role="group" aria-label="Filter places">
          {filters.map((item) => (
            <button
              type="button"
              key={item.key}
              className={cn("chip", filter === item.key && "is-active")}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error && (
          <p className="map-status">
            {error}
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              Try again
            </button>
          </p>
        )}
        {!loading && !error && !visible.length && (
          <p className="map-status">No places here yet. Try moving the map or zooming out.</p>
        )}
        {!error && (
          <ul className="place-grid">
            {visible.slice(0, 60).map((place) => (
              <li
                key={place.id}
                onMouseEnter={() => {
                  const marker = markers.current[visible.indexOf(place)];
                  marker?.getElement().classList.add("is-selected");
                }}
                onMouseLeave={() => {
                  const marker = markers.current[visible.indexOf(place)];
                  if (selected?.id !== place.id) marker?.getElement().classList.remove("is-selected");
                }}
              >
                <PlaceTile place={place} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="map-canvas-wrap">
        <div ref={container} className="map-canvas" aria-label="Map of halal places" />
        <div className="map-controls" aria-label="Map controls">
          <div className="map-controls-group">
            <button type="button" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
              <Plus size={18} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
              <Minus size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="map-controls-group">
            <button type="button" aria-label="Find my location" onClick={locate}>
              <LocateFixed size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {notice && (
          <div className="map-toast" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setNotice("")}>
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        {selected && <SelectedCard place={selected} onClose={closeSelected} />}
      </div>

      <button
        type="button"
        className="floating-pill map-view-toggle"
        onClick={() => setShowList((value) => !value)}
      >
        {showList ? (
          <>
            Show map <MapIcon size={16} aria-hidden="true" />
          </>
        ) : (
          <>
            Show list <LayoutGrid size={16} aria-hidden="true" />
          </>
        )}
      </button>
    </div>
  );
}
