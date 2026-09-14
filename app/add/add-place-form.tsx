"use client";

import { useEffect, useState } from "react";
import ShareButton from "../../src/components/share-button";

type AuthState = "checking" | "signed-in" | "signed-out";
type Mode = "google" | "manual";
type GooglePlace = { id: string; name: string; address: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function responseBody(response: Response) {
  try {
    return record(await response.json());
  } catch {
    return null;
  }
}

function errorFrom(body: Record<string, unknown> | null, fallback: string) {
  return typeof body?.error === "string" && body.error.trim()
    ? body.error
    : fallback;
}

const loginUrl = "/login?returnTo=%2Fadd";
const draftKey = "halalfood.world:add-place-draft";

export default function AddPlaceForm() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [mode, setMode] = useState<Mode>("google");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GooglePlace[]>([]);
  const [selected, setSelected] = useState<GooglePlace | null>(null);
  const [googleAvailable, setGoogleAvailable] = useState(true);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [manualPlaceId, setManualPlaceId] = useState("");
  const [halalConfirmed, setHalalConfirmed] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [successId, setSuccessId] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/get-session", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(responseBody)
      .then((body) => {
        if (!active) return;
        const user = record(body?.user);
        setAuthState(typeof user?.id === "string" ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (active) setAuthState("signed-out");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      const rawDraft = sessionStorage.getItem(draftKey);
      const draft = rawDraft ? record(JSON.parse(rawDraft)) : null;
      if (!draft) return;
      if (draft.mode === "google" || draft.mode === "manual") setMode(draft.mode);
      const selectedDraft = record(draft.selected);
      if (
        typeof selectedDraft?.id === "string" &&
        typeof selectedDraft.name === "string" &&
        typeof selectedDraft.address === "string"
      ) {
        setSelected({
          id: selectedDraft.id,
          name: selectedDraft.name,
          address: selectedDraft.address,
        });
      }
      if (typeof draft.query === "string") setQuery(draft.query);
      if (typeof draft.name === "string") setName(draft.name);
      if (typeof draft.address === "string") setAddress(draft.address);
      if (typeof draft.city === "string") setCity(draft.city);
      if (typeof draft.manualPlaceId === "string") setManualPlaceId(draft.manualPlaceId);
      if (draft.halalConfirmed === true) setHalalConfirmed(true);
    } catch {
      // Ignore a malformed or unavailable browser draft.
    }
  }, []);

  const saveDraft = () => {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          mode,
          query,
          name,
          address,
          city,
          manualPlaceId,
          halalConfirmed,
          selected,
        }),
      );
    } catch {
      // The form still works when storage is unavailable.
    }
  };

  const clearDraft = () => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore storage cleanup failures.
    }
  };

  const chooseMode = (nextMode: Mode) => {
    setMode(nextMode);
    setSearchResults([]);
    setSearchError("");
    setSelected(null);
    if (nextMode === "google") setManualPlaceId("");
  };

  const searchGoogle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const search = query.trim();
    if (search.length < 2) {
      setSearchError("Enter at least 2 characters to search.");
      return;
    }
    setSearchBusy(true);
    setSearchError("");
    try {
      const response = await fetch(
        "/api/places/google-search?q=" + encodeURIComponent(search),
        { credentials: "include", cache: "no-store" },
      );
      const body = await responseBody(response);
      if (response.status === 401) {
        setAuthState("signed-out");
        return;
      }
      if (!response.ok) {
        if (response.status === 503) setGoogleAvailable(false);
        setSearchError(
          errorFrom(body, "Google search failed. You can enter the place manually."),
        );
        return;
      }
      const rawPlaces = Array.isArray(body?.places) ? body.places : [];
      const places = rawPlaces.flatMap((value): GooglePlace[] => {
        const place = record(value);
        return typeof place?.id === "string" &&
          typeof place.name === "string" &&
          typeof place.address === "string"
          ? [{ id: place.id, name: place.name, address: place.address }]
          : [];
      });
      setSearchResults(places);
      if (!places.length) setSearchError("No Google matches found. Try another search or use manual entry.");
    } catch {
      setSearchError("Google search failed. You can enter the place manually.");
    } finally {
      setSearchBusy(false);
    }
  };

  const selectGooglePlace = (place: GooglePlace) => {
    setSelected(place);
    setName(place.name);
    setAddress(place.address);
    setSearchResults([]);
    setSearchError("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (mode === "google" && !selected) {
      setFormError("Search for the place and choose a Google result first.");
      return;
    }
    if (!halalConfirmed) {
      setFormError("Confirm that this place is halal before submitting.");
      return;
    }

    if (authState === "signed-out") {
      saveDraft();
      window.location.assign(loginUrl);
      return;
    }

    setSubmitBusy(true);
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          mode,
          name,
          address,
          city,
          googlePlaceId: mode === "google" ? selected?.id : manualPlaceId,
          halalConfirmed,
        }),
      });
      const body = await responseBody(response);
      if (response.status === 401) {
        setAuthState("signed-out");
        return;
      }
      if (!response.ok) {
        setFormError(errorFrom(body, "We could not add that place. Please try again."));
        return;
      }
      if (typeof body?.id !== "string" || !body.id) {
        setFormError("The place was added, but its link was missing. Please check the map.");
        return;
      }
      setSuccessId(body.id);
      clearDraft();
    } catch {
      setFormError("We could not add that place. Please try again.");
    } finally {
      setSubmitBusy(false);
    }
  };

  const reset = () => {
    setSuccessId("");
    clearDraft();
    setMode("google");
    setQuery("");
    setSearchResults([]);
    setSelected(null);
    setName("");
    setAddress("");
    setCity("");
    setManualPlaceId("");
    setHalalConfirmed(false);
    setFormError("");
    setSearchError("");
  };

  if (authState === "checking")
    return (
      <section className="add-place-card" aria-live="polite">
        <p className="eyebrow">ADD A PLACE</p>
        <h1>Checking your sign-in…</h1>
      </section>
    );

  if (successId)
    return (
      <section className="success-card" aria-labelledby="add-success-title">
        <p className="eyebrow">THANK YOU</p>
        <h1 id="add-success-title">Your place is listed</h1>
        <p className="lead">
          Thanks for helping people find more halal food. Please still confirm the details
          with the restaurant before visiting.
        </p>
        <div className="detail-actions">
          <a className="action primary" href={"/place/" + successId}>
            View the place
          </a>
          <ShareButton
            url={"/place/" + successId}
            title={name || "A halal place on halalfood.world"}
            text={(name || "This halal place") + " is now on Halalfood."}
            className="action share-button"
          />
          <button type="button" className="action" onClick={reset}>
            Add another place
          </button>
        </div>
      </section>
    );

  return (
    <section className="add-place-card" aria-labelledby="add-place-title">
      <p className="eyebrow">COMMUNITY SUBMISSION</p>
      <h1 id="add-place-title">Add a halal place</h1>
      <p className="lead">
        Know a halal place missing from the map? Find it with Google Places or enter its
        details yourself.
      </p>
      {authState === "signed-out" && (
        <p className="contribution-auth-note">
          You can prepare the listing now. We will ask you to sign in when you submit it.
        </p>
      )}

      <div className="mode-toggle" role="tablist" aria-label="Place entry method">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "google"}
          className={mode === "google" ? "mode-option selected" : "mode-option"}
          onClick={() => chooseMode("google")}
        >
          Search with Google
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          className={mode === "manual" ? "mode-option selected" : "mode-option"}
          onClick={() => chooseMode("manual")}
        >
          Enter manually
        </button>
      </div>

      {mode === "google" && (
        <div className="google-picker">
          <form className="google-search-form" onSubmit={searchGoogle}>
            <label htmlFor="google-place-search">Search by place name or address</label>
            <div className="search-row">
              <input
                id="google-place-search"
                type="search"
                maxLength={120}
                placeholder="e.g. a halal restaurant in Mumbai"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button className="action" type="submit" disabled={searchBusy}>
                {searchBusy ? "Searching…" : "Search"}
              </button>
            </div>
          </form>
          {!googleAvailable && (
            <p className="form-help">Google search is not configured here. Manual entry is ready below.</p>
          )}
          {selected && (
            <div className="selected-place">
              <p className="eyebrow">SELECTED FROM GOOGLE</p>
              <strong>{selected.name}</strong>
              <span>{selected.address}</span>
              <button type="button" className="auth-secondary" onClick={() => setSelected(null)}>
                Choose another result
              </button>
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="google-results" role="list" aria-label="Google place results">
              {searchResults.map((place) => (
                <button type="button" key={place.id} onClick={() => selectGooglePlace(place)}>
                  <strong>{place.name}</strong>
                  <small>{place.address}</small>
                </button>
              ))}
            </div>
          )}
          {searchError && <p className="form-help" role="status">{searchError}</p>}
        </div>
      )}

      <form className="add-place-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="place-name">Place name</label>
          <input
            id="place-name"
            type="text"
            required
            maxLength={200}
            readOnly={mode === "google"}
            placeholder="Restaurant or food shop name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="place-address">Street address</label>
          <input
            id="place-address"
            type="text"
            required
            maxLength={300}
            readOnly={mode === "google"}
            placeholder="Street and number"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="place-city">City or locality</label>
          <input
            id="place-city"
            type="text"
            required
            maxLength={120}
            autoComplete="address-level2"
            placeholder="e.g. Mumbai"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
          <p className="field-note">This determines the city page for the listing.</p>
        </div>
        {mode === "manual" && (
          <div className="field">
            <label htmlFor="manual-place-id">Google Place ID <span>(optional)</span></label>
            <input
              id="manual-place-id"
              type="text"
              maxLength={300}
              placeholder="Only if you already have one"
              value={manualPlaceId}
              onChange={(event) => setManualPlaceId(event.target.value)}
            />
          </div>
        )}
        <label className="check-field">
          <input
            type="checkbox"
            required
            checked={halalConfirmed}
            onChange={(event) => setHalalConfirmed(event.target.checked)}
          />
          <span>I confirm this place is halal and should be listed as halal.</span>
        </label>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <button className="action primary add-submit" type="submit" disabled={submitBusy}>
          {submitBusy ? "Adding place…" : "Add this place"}
        </button>
      </form>
      <p className="add-place-note">
        Please submit places you believe are halal. Locations from Google are copied into
        the listing; map pins may still be approximate.
      </p>
    </section>
  );
}
