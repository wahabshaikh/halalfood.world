"use client";

import { Heart } from "lucide-react";
import { useEffect, useState } from "react";

type SavedPlacesPayload = {
  places?: Array<{ id?: unknown }>;
};

let savedPlaceIds: Set<string> | null = null;
let savedPlacesLoad: Promise<Set<string>> | null = null;
let savedPlacesAuth: "unknown" | "authenticated" | "unauthenticated" =
  "unknown";

const PENDING_SAVE_KEY = "halalfood:pending-save";

/**
 * Send a signed-out visitor to log in, remembering what they tapped so the
 * save happens the moment they're back on the same page.
 */
function goToLogin(placeId: string) {
  try {
    localStorage.setItem(PENDING_SAVE_KEY, placeId);
  } catch {
    // Without storage they just tap the heart again after logging in.
  }
  const here = window.location.pathname + window.location.search;
  window.location.assign(
    `/login?reason=save&returnTo=${encodeURIComponent(here || `/place/${placeId}`)}`,
  );
}

/** Claim a pending save for this place, once, across every button on the page. */
function takePendingSave(placeId: string) {
  try {
    if (localStorage.getItem(PENDING_SAVE_KEY) !== placeId) return false;
    localStorage.removeItem(PENDING_SAVE_KEY);
    return true;
  } catch {
    return false;
  }
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
  heart = false,
  initialSaved = false,
  className = "",
  onSavedChange,
}: {
  placeId: string;
  compact?: boolean;
  /** Icon-only heart that sits on top of a photo, like a wishlist toggle. */
  heart?: boolean;
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
        if (!mounted) return;
        setSaved(ids.has(placeId));
        if (
          savedPlacesAuth === "authenticated" &&
          !ids.has(placeId) &&
          takePendingSave(placeId)
        )
          void toggleSaved(true);
      })
      .catch(() => {
        // A failed status read should not prevent a later save attempt.
      });
    return () => {
      mounted = false;
    };
  }, [initialSaved, placeId]);

  async function toggleSaved(force?: boolean) {
    setError("");
    if (savedPlacesAuth === "unauthenticated") {
      goToLogin(placeId);
      return;
    }

    setBusy(true);
    const nextSaved = force ?? !saved;
    try {
      const response = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/saved`,
        { method: nextSaved ? "POST" : "DELETE", headers: { Accept: "application/json" } },
      );
      if (response.status === 401) {
        goToLogin(placeId);
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
    heart ? "is-heart" : "",
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
        <Heart
          size={heart ? 24 : compact ? 15 : 17}
          fill={saved ? "currentColor" : heart ? "rgba(0,0,0,0.45)" : "none"}
          strokeWidth={heart ? 2.2 : 2}
          aria-hidden="true"
        />
        {!heart && (
          <span>{busy ? (saved ? "Removing…" : "Saving…") : saved ? "Saved" : "Save"}</span>
        )}
      </button>
      {error && (
        <span className="save-place-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
