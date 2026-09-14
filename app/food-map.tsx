"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  LocateFixed,
  Maximize,
  Minus,
  Plus,
  Search,
  Utensils,
  X,
  List,
  ArrowUpRight,
  Star,
} from "lucide-react";
import type { Map as MapInstance, Marker, Popup } from "maplibre-gl";
import type { Place } from "../src/lib/places";
import SavePlaceButton from "../src/components/save-place-button";
import "maplibre-gl/dist/maplibre-gl.css";
// Bundle the worker explicitly so its URL exists in Cloudflare static assets.
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

type Results = { places: Place[]; total: number; limit: number };
const VIEWPORT_LIMIT = 600;
const DEFAULT_VIEW = { center: [72.8777, 19.055] as [number, number], zoom: 14 };

const foodIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v18M18 3c-3 3-3 8 0 8h2M20 3v18"/></svg>';
const address = (p: Place) =>
  [p.street_address, p.address_locality, p.address_country]
    .filter(Boolean)
    .join(", ");

function safeWebsite(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** `?lat=&lng=&z=` overrides the default view; anything invalid is ignored. */
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

export default function FoodMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const library = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const popup = useRef<Popup | null>(null);
  const popupSaveRoot = useRef<Root | null>(null);
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
  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [searchState, setSearchState] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const countRef = useRef<HTMLButtonElement>(null);

  /** Keep the address bar shareable without adding a history entry per pin. */
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
      const m = map.current,
        lib = library.current;
      if (!m || !lib) return;
      setSheet(false);
      setSearchOpen(false);
      if (options.fly !== false)
        m.flyTo({
          duration: 1200,
          center: [place.lng, place.lat],
          zoom: Math.max(m.getZoom(), 13),
        });
      popupSaveRoot.current?.unmount();
      popupSaveRoot.current = null;
      popup.current?.remove();
      syncUrl(place.id);

      const placeUrl = "/place/" + place.id;
      const content = document.createElement("div");
      content.className = "place-popup";
      const tag = document.createElement("span");
      tag.className = "eyebrow";
      tag.textContent = "HALAL FOOD";
      content.append(tag);
      const title = document.createElement("h2");
      const titleLink = document.createElement("a");
      titleLink.href = placeUrl;
      titleLink.textContent = place.name;
      title.append(titleLink);
      content.append(title);
      if (place.rating_value) {
        const rating = document.createElement("p");
        rating.className = "popup-rating";
        rating.textContent =
          "★ " +
          place.rating_value +
          (place.review_count ? " · " + place.review_count + " reviews" : "");
        content.append(rating);
      }
      const location = document.createElement("p");
      location.textContent = address(place);
      content.append(location);
      const note = document.createElement("p");
      note.className = "approximate";
      note.textContent = "Approximate pin. Confirm the address before visiting.";
      content.append(note);

      const links = document.createElement("div");
      links.className = "popup-links";
      const details = document.createElement("a");
      details.href = placeUrl;
      details.textContent = "Details";
      links.append(details);
      if (place.telephone) {
        const phone = document.createElement("a");
        phone.href = "tel:" + place.telephone.replace(/[^+\d]/g, "");
        phone.textContent = "Call";
        links.append(phone);
      }
      const website = safeWebsite(place.website);
      if (website) {
        const link = document.createElement("a");
        link.href = website;
        link.target = "_blank";
        link.rel = "noopener noreferrer nofollow";
        link.textContent = "Website ↗";
        links.append(link);
      }
      const share = document.createElement("button");
      share.type = "button";
      share.className = "popup-share";
      share.textContent = "Share";
      share.addEventListener("click", async () => {
        const shareUrl = new URL(placeUrl, window.location.origin).href;
        if (navigator.share) {
          try {
            await navigator.share({ title: place.name, url: shareUrl });
            return;
          } catch (e) {
            if ((e as Error)?.name === "AbortError") return;
          }
        }
        try {
          await navigator.clipboard.writeText(shareUrl);
          share.textContent = "Link copied";
          setTimeout(() => (share.textContent = "Share"), 2400);
        } catch {
          setNotice("Copy the link from the address bar to share this place.");
        }
      });
      links.append(share);
      const saveMount = document.createElement("span");
      saveMount.className = "popup-save-mount";
      links.append(saveMount);
      content.append(links);

      popupSaveRoot.current = createRoot(saveMount);
      popupSaveRoot.current.render(
        <SavePlaceButton placeId={place.id} compact />,
      );

      popup.current = new lib.Popup({ offset: 26, maxWidth: "320px" })
        .setLngLat([place.lng, place.lat])
        .setDOMContent(content)
        .addTo(m);
      popup.current.once("close", () => syncUrl(null));
      popup.current.once("close", () => {
        popupSaveRoot.current?.unmount();
        popupSaveRoot.current = null;
      });
    },
    [syncUrl],
  );

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const view = viewFromParams(params) ?? DEFAULT_VIEW;
    import("maplibre-gl")
      .then((lib) => {
        if (cancelled || !container.current) return;
        lib.setWorkerUrl(mapWorkerUrl);
        library.current = lib;
        const m = new lib.Map({
          container: container.current,
          style:
            "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
          center: view.center,
          zoom: view.zoom,
          attributionControl: { compact: true },
        });
        map.current = m;
        m.on("load", () => {
          styleReady.current = true;
          setReady(true);
          setMapError("");
        });
        // Tiles fail transiently all the time; only a dead style is fatal.
        m.on("error", () => {
          if (!styleReady.current)
            setMapError("The basemap could not load. Check your connection.");
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
      popupSaveRoot.current?.unmount();
      popupSaveRoot.current = null;
      styleReady.current = false;
    };
  }, []);

  // Deep links: /?place=<id> opens a pin, /?city=<slug> frames a city.
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
          const response = await fetch(
            "/api/places/" + encodeURIComponent(placeId),
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error();
          const place = (await response.json()) as Place;
          if (typeof place.lat !== "number" || typeof place.lng !== "number")
            throw new Error();
          map.current?.jumpTo({ center: [place.lng, place.lat], zoom: 15 });
          selectPlace(place, { fly: false });
          return;
        }
        const response = await fetch(
          "/api/cities/" + encodeURIComponent(citySlug!),
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const city = (await response.json()) as {
          center_lat: number | null;
          center_lng: number | null;
        };
        if (city.center_lat === null || city.center_lng === null)
          throw new Error();
        map.current?.jumpTo({
          center: [city.center_lng, city.center_lat],
          zoom: 12,
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setNotice("That link could not be opened. Showing the map instead.");
      }
    })();
    return () => controller.abort();
    // Runs once the map is live; later selections manage their own URL.
  }, [ready, selectPlace]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const m = map.current;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      controller?.abort();
      controller = new AbortController();
      setLoading(true);
      setError("");
      const bounds = m.getBounds();
      const wrap = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
      const world = bounds.getEast() - bounds.getWest() >= 360;
      const bbox = [
        world ? -180 : wrap(bounds.getWest()),
        Math.max(-90, bounds.getSouth()),
        world ? 180 : wrap(bounds.getEast()),
        Math.min(90, bounds.getNorth()),
      ];
      try {
        const response = await fetch(
          "/api/places?bbox=" + bbox.join(",") + "&limit=" + VIEWPORT_LIMIT,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error("Places could not load. Please try again.");
        setResults(await response.json());
        setLoading(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message);
          setResults({ places: [], total: 0, limit: VIEWPORT_LIMIT });
          setLoading(false);
        }
      }
    }
    const schedule = () => {
      clearTimeout(timer);
      controller?.abort();
      timer = setTimeout(load, 180);
    };
    m.on("moveend", schedule);
    void load();
    return () => {
      clearTimeout(timer);
      controller?.abort();
      m.off("moveend", schedule);
    };
  }, [ready, retry]);

  useEffect(() => {
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    if (!ready || !map.current || !library.current) return;
    markers.current = results.places.map((place) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "food-marker";
      button.innerHTML = foodIcon;
      button.setAttribute("aria-label", place.name);
      button.title = place.name;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        selectPlace(place);
      });
      return new library.current!.Marker({ element: button })
        .setLngLat([place.lng, place.lat])
        .addTo(map.current!);
    });
  }, [results, ready, selectPlace]);

  useEffect(() => {
    const query = q.trim();
    const controller = new AbortController();
    setSearchResults([]);
    if (query.length < 2) {
      setSearchState(query ? "Keep typing — at least 2 characters." : "");
      return;
    }
    setSearchState("Searching…");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          "/api/places/search?q=" + encodeURIComponent(query) + "&limit=12",
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const data: Results = await response.json();
        setSearchResults(data.places);
        setSearchState(
          data.places.length
            ? ""
            : "No halal places match that. Try a city or another name.",
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setSearchState("Search could not load. Please try again.");
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  useEffect(() => {
    if (sheet) sheetRef.current?.showModal();
    else if (sheetRef.current?.open) {
      sheetRef.current.close();
      countRef.current?.focus();
    }
  }, [sheet]);

  function locate() {
    if (!navigator.geolocation) {
      setNotice("This browser cannot share your location. Search for a city instead.");
      return;
    }
    setNotice("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.current?.flyTo({
          duration: 1200,
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 13,
        });
        setNotice("");
      },
      (positionError) =>
        setNotice(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Location permission is off. Turn it on, or search for your city."
            : "We could not pin down your location. Search for your city instead.",
        ),
      { timeout: 10000 },
    );
  }

  const countLabel = loading
    ? "Finding places…"
    : error
      ? "Places unavailable"
      : results.total === 0
        ? "No places here"
        : results.total.toLocaleString() +
          (results.total === 1 ? " place" : " places");

  return (
    <main className="map-app">
      <div
        ref={container}
        className="map-canvas"
        aria-label="Map of halal food places"
      />
      <header className="map-chrome">
        <a className="brand pill" href="/" aria-label="Halalfood home">
          <span className="brand-icon">
            <Utensils size={20} />
          </span>
          <span>Halalfood</span>
        </a>
        <nav className="chrome-nav" aria-label="Directory">
          <a className="pill chrome-link" href="/cities">
            Browse cities
          </a>
          <a className="pill chrome-link" href="/add">
            Add a place
          </a>
          <a className="pill chrome-link" href="/saved">
            Saved
          </a>
          <a className="pill chrome-link" href="/login">
            Sign in
          </a>
        </nav>
      </header>
      <div className="search-area">
        <form
          className="search-pill pill"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (searchResults[0]) selectPlace(searchResults[0]);
          }}
        >
          <Search size={21} aria-hidden="true" />
          <input
            aria-label="Search for halal food"
            placeholder="Search halal food or a city…"
            value={q}
            maxLength={120}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => {
              setQ(event.target.value);
              setSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchOpen(false);
            }}
          />
          {q && (
            <button
              type="button"
              className="clear-search"
              aria-label="Clear search"
              onClick={() => {
                setQ("");
                setSearchOpen(false);
              }}
            >
              <X size={18} />
            </button>
          )}
        </form>
        {searchOpen && q && (
          <div className="search-results">
            {searchState && <p role="status">{searchState}</p>}
            {searchResults.map((place) => (
              <button
                type="button"
                key={place.id}
                onClick={() => selectPlace(place)}
              >
                <span className="result-icon">
                  <Utensils size={19} />
                </span>
                <span>
                  <strong>{place.name}</strong>
                  <small>{address(place)}</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
        )}
      </div>
      {(error || mapError || notice) && (
        <div className="toast" role="status">
          <span>{error || mapError || notice}</span>
          {error && (
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              Retry
            </button>
          )}
          {!error && notice && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
      <div className="map-controls" aria-label="Map controls">
        <div className="zoom-controls">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => map.current?.zoomIn()}
          >
            <Plus size={20} />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => map.current?.zoomOut()}
          >
            <Minus size={20} />
          </button>
        </div>
        <button type="button" aria-label="Find my location" onClick={locate}>
          <LocateFixed size={20} />
        </button>
        <button
          type="button"
          aria-label="Toggle fullscreen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else if (document.documentElement.requestFullscreen)
              void document.documentElement
                .requestFullscreen()
                .catch(() =>
                  setNotice("Fullscreen is unavailable in this browser."),
                );
            else setNotice("Fullscreen is unavailable in this browser.");
          }}
        >
          <Maximize size={20} />
        </button>
      </div>
      <div className="bottom-area">
        <button
          type="button"
          ref={countRef}
          className={loading ? "count-pill is-loading" : "count-pill"}
          onClick={() => setSheet(true)}
          aria-haspopup="dialog"
        >
          <List size={20} />
          <span>{countLabel}</span>
        </button>
        <span className="map-note">Halal only · Pins are approximate</span>
      </div>
      <dialog
        ref={sheetRef}
        className="list-sheet"
        onCancel={(event) => {
          event.preventDefault();
          setSheet(false);
        }}
        onClick={(event) => {
          if (event.target === sheetRef.current) setSheet(false);
        }}
        aria-labelledby="sheet-title"
      >
        <div className="sheet-handle" />
        <header>
          <div>
            <span className="eyebrow">EXPLORE THIS AREA</span>
            <h2 id="sheet-title">{countLabel}</h2>
          </div>
          <button
            type="button"
            className="close-sheet"
            aria-label="Close places list"
            onClick={() => setSheet(false)}
          >
            <X size={20} />
          </button>
        </header>
        <p className="sheet-description">
          {results.total > results.places.length
            ? `Showing the ${results.places.length} best-rated of ${results.total.toLocaleString()} places here. Zoom in for the rest.`
            : "Tap a place to see it on the map."}{" "}
          Pins are approximate — confirm addresses before visiting.
        </p>
        <div className="place-list">
          {loading && (
            <p className="sheet-status" role="status">
              Loading places…
            </p>
          )}
          {error && (
            <p className="sheet-status" role="alert">
              {error}{" "}
              <button
                type="button"
                className="inline-retry"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry
              </button>
            </p>
          )}
          {!loading && !error && !results.places.length && (
            <p className="sheet-status">
              No halal places in this view yet. Zoom out, or{" "}
              <a href="/cities">browse by city</a>.
            </p>
          )}
          <ul>
            {results.places.map((place) => (
              <li className="place-row" key={place.id}>
                <button
                  type="button"
                  className="place-row-main"
                  onClick={() => selectPlace(place)}
                >
                  <span className="list-food-icon">
                    <Utensils size={21} />
                  </span>
                  <span className="place-row-info">
                    <strong>{place.name}</strong>
                    <small>{address(place)}</small>
                    {place.rating_value && (
                      <span className="rating">
                        <Star size={13} fill="currentColor" />
                        {place.rating_value}
                        <span>
                          {place.review_count
                            ? " (" + place.review_count + ")"
                            : ""}
                        </span>
                      </span>
                    )}
                  </span>
                </button>
                <a
                  className="place-row-link"
                  href={"/place/" + place.id}
                  aria-label={"Details for " + place.name}
                >
                  <ArrowUpRight size={19} />
                </a>
                <SavePlaceButton placeId={place.id} compact />
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </main>
  );
}
