"use client";

import { useEffect, useState } from "react";

const RATING_VALUES = [
  "mashallah",
  "alhamdulillah",
  "astaghfirullah",
] as const;

type PlaceRating = (typeof RATING_VALUES)[number];
type AuthState = "checking" | "signed-in" | "signed-out";
type RatingPayload = {
  rating: PlaceRating | null;
  counts: Record<PlaceRating, number> & { total: number };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPlaceRating(value: unknown): value is PlaceRating {
  return (
    typeof value === "string" &&
    (RATING_VALUES as readonly string[]).includes(value)
  );
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function readRatingPayload(value: unknown): RatingPayload | null {
  const body = record(value);
  const counts = record(body?.counts);
  if (!counts) return null;
  return {
    rating:
      body?.rating === null || isPlaceRating(body?.rating)
        ? body?.rating
        : null,
    counts: {
      mashallah: count(counts.mashallah),
      alhamdulillah: count(counts.alhamdulillah),
      astaghfirullah: count(counts.astaghfirullah),
      total: count(counts.total),
    },
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFrom(value: unknown, fallback: string) {
  const body = record(value);
  return typeof body?.error === "string" && body.error.trim()
    ? body.error
    : fallback;
}

function loginUrl(placeId: string) {
  return `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`;
}

const RATING_LABELS: Record<PlaceRating, string> = {
  mashallah: "MashaAllah",
  alhamdulillah: "Alhamdulillah",
  astaghfirullah: "Astaghfirullah",
};

const RATING_DESCRIPTIONS: Record<PlaceRating, string> = {
  mashallah: "A place you would happily return to",
  alhamdulillah: "A useful halal option for this visit",
  astaghfirullah: "A caution for the next visitor",
};

function label(rating: PlaceRating) {
  return RATING_LABELS[rating];
}

function description(rating: PlaceRating) {
  return RATING_DESCRIPTIONS[rating];
}

export default function PlaceRating({ placeId }: { placeId: string }) {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [payload, setPayload] = useState<RatingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<PlaceRating | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      setError("");
      try {
        const [ratingResponse, sessionResponse] = await Promise.all([
          fetch(`/api/places/${encodeURIComponent(placeId)}/rating`, {
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json" },
          }),
          fetch("/api/auth/get-session", {
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json" },
          }),
        ]);
        const ratingBody = await responseBody(ratingResponse);
        const sessionBody = await responseBody(sessionResponse);
        const sessionUser = record(record(sessionBody)?.user);
        if (!mounted) return;
        setAuthState(
          typeof sessionUser?.id === "string" ? "signed-in" : "signed-out",
        );
        if (!ratingResponse.ok) {
          setError(errorFrom(ratingBody, "Halal reactions could not be loaded."));
          return;
        }
        const next = readRatingPayload(ratingBody);
        if (!next) {
          setError("Halal reactions could not be loaded. Please try again.");
          return;
        }
        setPayload(next);
      } catch {
        if (mounted) {
          setAuthState("signed-out");
          setError("Halal reactions could not be loaded. Please try again.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [placeId]);

  async function choose(rating: PlaceRating) {
    if (authState === "signed-out") {
      window.location.assign(loginUrl(placeId));
      return;
    }
    setError("");
    setBusy(rating);
    try {
      const response = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/rating`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ rating }),
        },
      );
      const body = await responseBody(response);
      if (response.status === 401) {
        window.location.assign(loginUrl(placeId));
        return;
      }
      if (!response.ok) {
        setError(errorFrom(body, "Could not save your halal reaction."));
        return;
      }
      const next = readRatingPayload(body);
      if (!next) {
        setError("Could not read the updated halal reactions. Please try again.");
        return;
      }
      setPayload(next);
      setAuthState("signed-in");
    } catch {
      setError("Could not save your halal reaction. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="place-rating-title">
      <div className="section-head">
        <div>
          <h2 id="place-rating-title" style={{ fontSize: 22 }}>
            How was it?
          </h2>
          <p>A quick signal from your visit. It’s your impression, not a halal certificate.</p>
        </div>
        {payload && (
          <span className="status-pill">
            {payload.counts.total} {payload.counts.total === 1 ? "signal" : "signals"}
          </span>
        )}
      </div>

      {loading && <p className="form-help">Loading…</p>}
      {!loading && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && payload && (
        <>
          <div className="rating-options" role="group" aria-label="Choose a visit signal">
            {RATING_VALUES.map((rating) => {
              const selected = payload.rating === rating;
              return (
                <button
                  type="button"
                  className={`rating-option${selected ? " is-selected" : ""}`}
                  key={rating}
                  aria-pressed={selected}
                  aria-busy={busy === rating}
                  disabled={busy !== null || authState === "checking"}
                  onClick={() => void choose(rating)}
                >
                  <small>{payload.counts[rating]}</small>
                  <strong>{busy === rating ? "Saving…" : label(rating)}</strong>
                  <span>{selected ? "Your signal" : description(rating)}</span>
                </button>
              );
            })}
          </div>
          {authState === "signed-out" && (
            <p className="field-note" style={{ marginTop: 10 }}>
              <a className="link-underline" href={loginUrl(placeId)}>
                Log in
              </a>{" "}
              to add yours. You can change it any time.
            </p>
          )}
        </>
      )}
    </section>
  );
}
