"use client";

import { useEffect, useRef, useState } from "react";
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
import "maplibre-gl/dist/maplibre-gl.css";
// Bundle the worker explicitly so its URL exists in Cloudflare static assets.
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

type Results = { places: Place[]; total: number; limit: number };
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

export default function FoodMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const library = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const popup = useRef<Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [results, setResults] = useState<Results>({
    places: [],
    total: 0,
    limit: 600,
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

  function selectPlace(place: Place) {
    const m = map.current,
      lib = library.current;
    if (!m || !lib) return;
    setSheet(false);
    setSearchOpen(false);
    m.flyTo({
      duration: 1200,
      center: [place.lng, place.lat],
      zoom: Math.max(m.getZoom(), 13),
    });
    popup.current?.remove();
    const content = document.createElement("div");
    content.className = "place-popup";
    const tag = document.createElement("span");
    tag.className = "eyebrow";
    tag.textContent = "HALAL FOOD";
    content.append(tag);
    const title = document.createElement("h2");
    title.textContent = place.name;
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
    if (place.telephone) {
      const phone = document.createElement("a");
      phone.href = "tel:" + place.telephone.replace(/[^+\d]/g, "");
      phone.textContent = place.telephone;
      links.append(phone);
    }
    const website = safeWebsite(place.website);
    if (website) {
      const link = document.createElement("a");
      link.href = website;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Website ↗";
      links.append(link);
    }
    content.append(links);
    popup.current = new lib.Popup({ offset: 26, maxWidth: "320px" })
      .setLngLat([place.lng, place.lat])
      .setDOMContent(content)
      .addTo(m);
  }

  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl")
      .then((lib) => {
        if (cancelled || !container.current) return;
        lib.setWorkerUrl(mapWorkerUrl);
        library.current = lib;
        const m = new lib.Map({
          container: container.current,
          style:
            "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
          center: [72.8777, 19.055],
          zoom: 14,
          attributionControl: { compact: true },
        });
        map.current = m;
        m.on("load", () => {
          setReady(true);
          setMapError("");
        });
        m.on("error", () =>
          setMapError("The basemap could not load. Check your connection."),
        );
      })
      .catch(() => {
        setMapError("The map could not start. Please reload the page.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

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
          "/api/places?bbox=" + bbox.join(",") + "&limit=600",
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error("Places could not load. Please try again.");
        setResults(await response.json());
        setLoading(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message);
          setResults({ places: [], total: 0, limit: 600 });
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
  }, [results, ready]);

  useEffect(() => {
    const query = q.trim();
    const controller = new AbortController();
    setSearchResults([]);
    if (query.length < 2) {
      setSearchState(query ? "Type at least 2 characters" : "");
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
            : "No places found. Try a city or another name.",
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
      setNotice("Location is unavailable in this browser.");
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
      () => setNotice("Location is unavailable. Search for your city instead."),
      { timeout: 10000 },
    );
  }

  return (
    <main className="map-app">
      <div
        ref={container}
        className="map-canvas"
        aria-label="Map of halal food places"
      />
      <a className="brand pill" href="/" aria-label="Halalfood home">
        <span className="brand-icon">
          <Utensils size={21} />
        </span>
        <span>Halalfood</span>
      </a>
      <div className="search-area">
        <form
          className="search-pill pill"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (searchResults[0]) selectPlace(searchResults[0]);
          }}
        >
          <Search size={23} aria-hidden="true" />
          <input
            aria-label="Search for halal food"
            placeholder={["Search for ", "halal", " food\u2026"].join("")}
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
              <button key={place.id} onClick={() => selectPlace(place)}>
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
          {error || mapError || notice}
          {error && (
            <button onClick={() => setRetry((value) => value + 1)}>
              Retry
            </button>
          )}
          {notice && (
            <button aria-label="Dismiss" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          )}
        </div>
      )}
      <div className="map-controls" aria-label="Map controls">
        <div className="zoom-controls">
          <button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
            <Plus />
          </button>
          <button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
            <Minus />
          </button>
        </div>
        <button aria-label="Locate me" onClick={locate}>
          <LocateFixed />
        </button>
        <button
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
          <Maximize />
        </button>
      </div>
      <div className="bottom-area">
        <button
          ref={countRef}
          className="count-pill"
          onClick={() => setSheet(true)}
          aria-haspopup="dialog"
        >
          <List size={22} />
          <span>
            {loading
              ? "Finding places…"
              : error
                ? "Places unavailable"
                : results.total.toLocaleString() + " places"}
          </span>
        </button>
        <span className="map-note">
          Discover halal food · Pins are approximate
        </span>
      </div>
      <dialog
        ref={sheetRef}
        className="list-sheet"
        onCancel={() => setSheet(false)}
        onClick={(event) => {
          if (event.target === sheetRef.current) setSheet(false);
        }}
        aria-labelledby="sheet-title"
      >
        <div className="sheet-handle" />
        <header>
          <div>
            <span className="eyebrow">EXPLORE THIS AREA</span>
            <h2 id="sheet-title">{results.total.toLocaleString()} places</h2>
          </div>
          <button
            className="close-sheet"
            aria-label="Close places list"
            onClick={() => setSheet(false)}
          >
            <X />
          </button>
        </header>
        <p className="sheet-description">
          {results.total > results.places.length
            ? "Showing " +
              results.places.length +
              " top-rated places. Zoom in to explore more."
            : "Find something delicious nearby."}{" "}
          Confirm addresses before visiting.
        </p>
        <div className="place-list">
          {loading && <p role="status">Loading places…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !error && !results.places.length && (
            <p>No places in this area yet. Zoom out or search for a city.</p>
          )}
          {results.places.map((place) => (
            <button
              className="place-row"
              key={place.id}
              onClick={() => selectPlace(place)}
            >
              <span className="list-food-icon">
                <Utensils size={23} />
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
              <ArrowUpRight size={19} />
            </button>
          ))}
        </div>
      </dialog>
    </main>
  );
}
