"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { FavouriteIcon } from "@hugeicons/core-free-icons";
import { Button } from "@halalfood/ui/components/button";
import { cn } from "@halalfood/ui/lib/utils";
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

  const label = busy ? (saved ? "Removing…" : "Saving…") : saved ? "Saved" : "Save";
  const icon = (
    <HugeiconsIcon
      icon={FavouriteIcon}
      size={heart ? 24 : compact ? 15 : 17}
      fill={saved ? "currentColor" : heart ? "rgba(0,0,0,0.45)" : "none"}
      strokeWidth={heart ? 2.2 : 2}
      className={cn(saved && !heart && "text-brand")}
      aria-hidden="true"
    />
  );

  return (
    <span className="relative inline-flex flex-col">
      {heart ? (
        <button
          type="button"
          className={cn(
            "p-0.5 text-white drop-shadow transition-transform hover:scale-110 disabled:opacity-60",
            saved && "text-brand [&_svg]:stroke-white",
            className,
          )}
          aria-label={saved ? "Remove this place from saved places" : "Save this place"}
          aria-pressed={saved}
          aria-busy={busy}
          disabled={busy}
          onClick={() => void toggleSaved()}
        >
          {icon}
        </button>
      ) : (
        <Button
          variant="ghost"
          size={compact ? "sm" : "lg"}
          className={cn("font-extrabold underline underline-offset-3", className)}
          aria-label={saved ? "Remove this place from saved places" : "Save this place"}
          aria-pressed={saved}
          aria-busy={busy}
          disabled={busy}
          onClick={() => void toggleSaved()}
        >
          {icon}
          <span>{label}</span>
        </Button>
      )}
      {error && (
        <span
          className="absolute top-[calc(100%+4px)] right-0 z-10 w-50 rounded-lg bg-popover px-2.5 py-2 text-xs text-destructive shadow-lg"
          role="alert"
        >
          {error}
        </span>
      )}
    </span>
  );
}
