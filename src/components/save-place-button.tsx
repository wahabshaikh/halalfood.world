"use client";

import { Bookmark } from "lucide-react";
import { useEffect, useState } from "react";

type SavedPlacesPayload = {
  places?: Array<{ id?: unknown }>;
};

let savedPlaceIds: Set<string> | null = null;
let savedPlacesLoad: Promise<Set<string>> | null = null;
let savedPlacesAuth: "unknown" | "authenticated" | "unauthenticated" =
  "unknown";

function loginUrl(placeId: string) {
  return `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`;
}

async function loadSavedPlaceIds() {
  if (savedPlaceIds) return savedPlaceIds;
  if (savedPlacesLoad) return savedPlacesLoad;

  savedPlacesLoad = fetch("/api/places/saved", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
    .then(async (response) => {
      if (response.status === 401) {
        savedPlacesAuth = "unauthenticated";
        savedPlaceIds = new Set();
        return savedPlaceIds;
      }
      if (!response.ok) throw new Error("Saved places could not load");
      const payload = (await response.json()) as SavedPlacesPayload;
      savedPlacesAuth = "authenticated";
      savedPlaceIds = new Set(
        (Array.isArray(payload.places) ? payload.places : [])
          .map((place) => (typeof place.id === "string" ? place.id : null))
          .filter((id): id is string => Boolean(id)),
      );
      return savedPlaceIds;
    })
    .catch((error) => {
      savedPlacesLoad = null;
      throw error;
    });

  return savedPlacesLoad;
}

function updateSavedPlace(placeId: string, saved: boolean) {
  if (!savedPlaceIds) savedPlaceIds = new Set();
  if (saved) savedPlaceIds.add(placeId);
  else savedPlaceIds.delete(placeId);
  savedPlacesAuth = "authenticated";
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" && payload.error
      ? payload.error
      : fallback;
  } catch {
    return fallback;
  }
}

export default function SavePlaceButton({
  placeId,
  compact = false,
  initialSaved = false,
  className = "",
  onSavedChange,
}: {
  placeId: string;
  compact?: boolean;
  initialSaved?: boolean;
  className?: string;
  onSavedChange?: (saved: boolean) => void;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialSaved) {
      updateSavedPlace(placeId, true);
      return;
    }
    let mounted = true;
    void loadSavedPlaceIds()
      .then((ids) => {
        if (mounted) setSaved(ids.has(placeId));
      })
      .catch(() => {
        // A failed status read should not prevent a later save attempt.
      });
    return () => {
      mounted = false;
    };
  }, [initialSaved, placeId]);

  async function toggleSaved() {
    setError("");
    if (savedPlacesAuth === "unauthenticated") {
      window.location.assign(loginUrl(placeId));
      return;
    }

    setBusy(true);
    const nextSaved = !saved;
    try {
      const response = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/saved`,
        { method: nextSaved ? "POST" : "DELETE", headers: { Accept: "application/json" } },
      );
      if (response.status === 401) {
        window.location.assign(loginUrl(placeId));
        return;
      }
      if (!response.ok) {
        setError(
          await responseError(
            response,
            response.status === 429
              ? "Too many save actions. Please try again later."
              : "Could not update saved places.",
          ),
        );
        return;
      }
      const payload = (await response.json()) as { saved?: unknown };
      const savedResult =
        typeof payload.saved === "boolean" ? payload.saved : nextSaved;
      setSaved(savedResult);
      updateSavedPlace(placeId, savedResult);
      onSavedChange?.(savedResult);
    } catch {
      setError("Could not update saved places. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const buttonClass = [
    "save-place-button",
    compact ? "compact" : "",
    saved ? "is-saved" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="save-place-control">
      <button
        type="button"
        className={buttonClass}
        aria-label={saved ? "Remove this place from saved places" : "Save this place"}
        aria-pressed={saved}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void toggleSaved()}
      >
        <Bookmark size={compact ? 15 : 17} fill={saved ? "currentColor" : "none"} />
        <span>{busy ? (saved ? "Removing…" : "Saving…") : saved ? "Saved" : "Save"}</span>
      </button>
      {error && (
        <span className="save-place-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
