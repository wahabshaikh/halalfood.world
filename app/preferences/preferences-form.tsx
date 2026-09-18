"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  MINIMUM_STATUS_OPTIONS,
  type UserPreferences,
} from "../../src/lib/user-preferences";
import { STATUS_COPY } from "../../src/lib/halal-taxonomy";

/**
 * Dietary standards.
 *
 * These are the user's own thresholds, not a platform ruling: the copy says so
 * explicitly, and the form is built so that leaving everything off is a valid,
 * fully working choice.
 */

const TOGGLES: Array<{
  key: keyof UserPreferences;
  label: string;
  hint: string;
}> = [
  {
    key: "requireCertification",
    label: "Require a named certification body",
    hint: "Hides places where no certifying body is on record.",
  },
  {
    key: "avoidAlcohol",
    label: "No alcohol served",
    hint: "A place with an unknown answer is flagged, not hidden.",
  },
  { key: "avoidPork", label: "No pork on the menu", hint: "Same rule for unknowns." },
  {
    key: "requireDedicatedKitchen",
    label: "Dedicated halal kitchen",
    hint: "Excludes venues known to share a kitchen or fryer.",
  },
  {
    key: "requirePrayerSpace",
    label: "Prayer space available",
    hint: "A practical filter, not a halal judgement.",
  },
  {
    key: "vegetarianOnly",
    label: "Vegetarian options needed",
    hint: "Useful when dining with a mixed group.",
  },
];

export default function PreferencesForm() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [state, setState] = useState<"loading" | "ready" | "saving">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allergyDraft, setAllergyDraft] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/preferences");
        if (response.status === 401) {
          const body = await response.json();
          if (typeof body.loginUrl === "string") window.location.href = body.loginUrl;
          return;
        }
        if (response.ok) {
          const body = await response.json();
          if (body?.preferences) setPreferences(body.preferences as UserPreferences);
        }
      } catch {
        setError("Could not load your standards. They are unchanged.");
      } finally {
        setState("ready");
      }
    })();
  }, []);

  async function save(next: UserPreferences) {
    setState("saving");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not save.");
        return;
      }
      setPreferences(body.preferences as UserPreferences);
      setMessage("Saved. These standards now apply on every place page.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setState("ready");
    }
  }

  if (state === "loading") return <p className="map-place-status">Loading your standards…</p>;

  const set = (patch: Partial<UserPreferences>) =>
    setPreferences((current) => ({ ...current, ...patch }));

  return (
    <div className="preferences-form">
      <fieldset className="filter-group">
        <legend>The weakest status you will consider</legend>
        <div className="chip-row">
          {MINIMUM_STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              className={`filter-chip${preferences.minimumStatus === status ? " is-active" : ""}`}
              aria-pressed={preferences.minimumStatus === status}
              onClick={() => set({ minimumStatus: status })}
            >
              {STATUS_COPY[status].label}
            </button>
          ))}
        </div>
        <p className="filter-note">
          {STATUS_COPY[preferences.minimumStatus].minimumEvidence}
        </p>
      </fieldset>

      <fieldset className="filter-group">
        <legend>Your factual requirements</legend>
        {TOGGLES.map((toggle) => (
          <label key={String(toggle.key)} className="check-in-check">
            <input
              type="checkbox"
              checked={Boolean(preferences[toggle.key])}
              onChange={(event) => set({ [toggle.key]: event.target.checked } as Partial<UserPreferences>)}
            />
            <span>
              <strong>{toggle.label}</strong>
              <small>{toggle.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="filter-group">
        <legend>Evidence freshness</legend>
        <div className="chip-row">
          {[null, 90, 180, 365].map((days) => (
            <button
              key={String(days)}
              type="button"
              className={`filter-chip${preferences.maxEvidenceAgeDays === days ? " is-active" : ""}`}
              aria-pressed={preferences.maxEvidenceAgeDays === days}
              onClick={() => set({ maxEvidenceAgeDays: days })}
            >
              {days === null ? "Any age" : `Within ${days} days`}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="filter-group">
        <legend>Allergies and other constraints</legend>
        <div className="dish-input">
          <input
            className="ui-input"
            value={allergyDraft}
            placeholder="peanuts, shellfish…"
            onChange={(event) => setAllergyDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const value = allergyDraft.trim().toLowerCase();
              if (!value || preferences.allergies.includes(value)) return;
              set({ allergies: [...preferences.allergies, value] });
              setAllergyDraft("");
            }}
          />
        </div>
        <div className="chip-row">
          {preferences.allergies.map((allergy) => (
            <button
              key={allergy}
              type="button"
              className="filter-chip is-active"
              onClick={() =>
                set({ allergies: preferences.allergies.filter((item) => item !== allergy) })
              }
            >
              {allergy} ✕
            </button>
          ))}
        </div>
        <p className="filter-note">
          Allergies always produce a reminder to confirm with the restaurant.
          The platform never claims a kitchen is safe for you.
        </p>
      </fieldset>

      <fieldset className="filter-group">
        <legend>Privacy</legend>
        <label className="check-in-check">
          <input
            type="checkbox"
            checked={preferences.visibilityVisits === "private"}
            onChange={(event) =>
              set({ visibilityVisits: event.target.checked ? "private" : "public" })
            }
          />
          <span>Keep my visits off my public profile.</span>
        </label>
        <label className="check-in-check">
          <input
            type="checkbox"
            checked={preferences.visibilityLists === "private"}
            onChange={(event) =>
              set({ visibilityLists: event.target.checked ? "private" : "public" })
            }
          />
          <span>Keep my lists private by default.</span>
        </label>
      </fieldset>

      {error && <p className="check-in-error" role="alert">{error}</p>}
      {message && <p className="contribute-message" role="status">{message}</p>}

      <button
        type="button"
        className="ui-button ui-button-default ui-button-lg"
        disabled={state === "saving"}
        onClick={() => void save(preferences)}
      >
        {state === "saving" ? "Saving…" : "Save my standards"}
      </button>
    </div>
  );
}
