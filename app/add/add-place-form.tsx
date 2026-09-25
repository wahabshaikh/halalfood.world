"use client";

import { useEffect, useState } from "react";
import { MapPin, Search } from "lucide-react";
import ShareButton from "../../src/components/share-button";
import { Illustration } from "../../src/components/art";

type AuthState = "checking" | "signed-in" | "signed-out";
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
  return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
}

const loginUrl = "/login?returnTo=%2Fadd";
const draftKey = "halalfood:add-place-draft";

/**
 * Places are added only by picking a Google Maps result. The name, address,
 * city and pin all come from Google on the server.
 */
export default function AddPlaceForm() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GooglePlace[]>([]);
  const [selected, setSelected] = useState<GooglePlace | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [halalConfirmed, setHalalConfirmed] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/get-session", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(responseBody)
      .then((body) => {
        if (active) setAuthState(typeof record(body?.user)?.id === "string" ? "signed-in" : "signed-out");
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
      const draft = record(JSON.parse(sessionStorage.getItem(draftKey) || "null"));
      if (!draft) return;
      const saved = record(draft.selected);
      if (typeof saved?.id === "string" && typeof saved.name === "string" && typeof saved.address === "string")
        setSelected({ id: saved.id, name: saved.name, address: saved.address });
      if (typeof draft.query === "string") setQuery(draft.query);
      if (draft.halalConfirmed === true) setHalalConfirmed(true);
    } catch {
      // A malformed or unavailable draft is ignored.
    }
  }, []);

  function saveDraft() {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ query, selected, halalConfirmed }));
    } catch {
      // The form still works without storage.
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore storage cleanup failures.
    }
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) {
      setSearchMessage("Type at least 2 letters.");
      return;
    }
    if (authState === "signed-out") {
      saveDraft();
      window.location.assign(loginUrl);
      return;
    }
    setSearchBusy(true);
    setSearchMessage("");
    try {
      const response = await fetch("/api/places/google-search?q=" + encodeURIComponent(term), {
        credentials: "include",
        cache: "no-store",
      });
      const body = await responseBody(response);
      if (response.status === 401) {
        setAuthState("signed-out");
        saveDraft();
        window.location.assign(loginUrl);
        return;
      }
      if (!response.ok) {
        setSearchMessage(errorFrom(body, "Google search didn’t work. Please try again."));
        return;
      }
      const places = (Array.isArray(body?.places) ? body.places : []).flatMap((value): GooglePlace[] => {
        const place = record(value);
        return typeof place?.id === "string" && typeof place.name === "string" && typeof place.address === "string"
          ? [{ id: place.id, name: place.name, address: place.address }]
          : [];
      });
      setResults(places);
      if (!places.length) setSearchMessage("Nothing on Google Maps matches that. Try the name and the area.");
    } catch {
      setSearchMessage("Google search didn’t work. Please try again.");
    } finally {
      setSearchBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!selected) {
      setFormError("Pick the place from the Google results first.");
      return;
    }
    if (!halalConfirmed) {
      setFormError("Please confirm this place serves halal food.");
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
        body: JSON.stringify({ mode: "google", googlePlaceId: selected.id, halalConfirmed }),
      });
      const body = await responseBody(response);
      if (response.status === 401) {
        setAuthState("signed-out");
        saveDraft();
        window.location.assign(loginUrl);
        return;
      }
      if (!response.ok || typeof body?.id !== "string") {
        setFormError(errorFrom(body, "We couldn’t add that place. Please try again."));
        return;
      }
      clearDraft();
      setSuccess({ id: body.id, name: selected.name });
    } catch {
      setFormError("We couldn’t add that place. Please try again.");
    } finally {
      setSubmitBusy(false);
    }
  }

  if (success)
    return (
      <section className="success-card" aria-labelledby="add-success-title">
        <Illustration name="visits" size={88} />
        <h1 id="add-success-title">{success.name} is on the map</h1>
        <p>
          Thank you! Want to go one step further? Tell us what you saw there. It takes about
          a minute.
        </p>
        <div className="button-row">
          <a className="btn btn-primary" href={`/place/${success.id}/check`}>
            Add a halal check
          </a>
          <a className="btn btn-line" href={`/place/${success.id}`}>
            See the place
          </a>
          <ShareButton
            url={`/place/${success.id}`}
            title={success.name}
            text={success.name + " is now on halalfood.world."}
          />
        </div>
      </section>
    );

  return (
    <section className="stack" aria-labelledby="add-place-title" style={{ maxWidth: 640 }}>
      <header className="page-intro" style={{ paddingBottom: 8 }}>
        <h1 id="add-place-title">Add a place</h1>
        <p className="lead">
          Search Google Maps and pick it. The address, city and pin come from Google, so
          they’re always right.
        </p>
        {authState === "signed-out" && (
          <p className="muted">You’ll need to log in with a one-time email code before you search.</p>
        )}
      </header>

      {selected ? (
        <div className="selected-place">
          <MapPin size={24} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>{selected.name}</strong>
            <span>{selected.address}</span>
          </div>
          <button
            type="button"
            className="link-underline"
            onClick={() => {
              setSelected(null);
              setFormError("");
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div className="picker-card">
          <form className="picker-search" role="search" onSubmit={(event) => void search(event)}>
            <Search size={20} aria-hidden="true" />
            <label className="sr-only" htmlFor="google-place-search">
              Search Google Maps
            </label>
            <input
              id="google-place-search"
              type="search"
              maxLength={120}
              placeholder="Restaurant name and area"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="btn btn-dark btn-sm" type="submit" disabled={searchBusy || authState === "checking"}>
              {searchBusy ? "Searching…" : "Search"}
            </button>
          </form>
          {results.length > 0 && (
            <div className="picker-results" role="list" aria-label="Google Maps results">
              {results.map((place) => (
                <button
                  type="button"
                  role="listitem"
                  className="picker-result"
                  key={place.id}
                  onClick={() => {
                    setSelected(place);
                    setResults([]);
                    setSearchMessage("");
                  }}
                >
                  <MapPin size={20} aria-hidden="true" />
                  <span>
                    <strong>{place.name}</strong>
                    <small>{place.address}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="picker-attribution">Results from Google</div>
        </div>
      )}
      {searchMessage && (
        <p className="form-help" role="status">
          {searchMessage}
        </p>
      )}

      <form className="stack" onSubmit={(event) => void submit(event)}>
        <label className="check-field">
          <input
            type="checkbox"
            checked={halalConfirmed}
            onChange={(event) => setHalalConfirmed(event.target.checked)}
          />
          <span>I believe this place serves halal food.</span>
        </label>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={submitBusy || !selected}>
          {submitBusy ? "Adding…" : selected ? `Add ${selected.name}` : "Add this place"}
        </button>
      </form>
      <div className="inline-card">
        <strong>Not on Google Maps yet?</strong>
        <p>
          We can only add places that are on Google Maps, so the details stay accurate. Once
          the owner lists it there, you can add it here.
        </p>
      </div>
    </section>
  );
}
